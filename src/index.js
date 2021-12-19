import helpers from "./helpers.js";
import SolverManager from "./SolverManager.js";
export const manager = new SolverManager();

/*
{
    userID: number,
    solvers: [{
        modelID: number,
        dataID: number,
        // solver: "",
    }]
}
*/
export async function addJob(msg, publish){
    const stmt = await helpers.query("INSERT INTO `jobs` (`userID`) VALUES (?)", [
        msg.userID,
    ]);
    const jobID = stmt?.insertId;
    if(jobID)
    {
        for(let i = 0; i < msg.solvers.length; i++)
        {
            const solver = msg.solvers[i];
            await helpers.query("INSERT INTO `jobFiles` (`modelID`, `dataID`, `jobID`) VALUES (?, ?, ?)", [
                msg.model,
                msg.dataset,
                jobID,
            ]);
        }
    }

    publish("add-job-response", {
        error: !jobID,
    });
    publish("queue-check", {});
}

export async function queueCheck(_, publish){
    const queue = await helpers.query("SELECT * " +
    "FROM `jobs` WHERE `status` = '0' ORDER BY `id` ASC LIMIT 1");
    console.log("Queue check", queue.length, "in queue");
    
    if(queue && queue.length > 0)
    {
        const job = queue[0];

        const {data: userInfo} = await helpers.publishAndWait("getUser", "getUser-response", 0, {
            id: job.userID,
        }, -1);
        if(userInfo)
        {
            const jobSolvers = await helpers.query("SELECT * FROM `jobFiles` WHERE `jobID` = ? ORDER BY `id` DESC", [
                job.id,
            ]);
            const neededResources = Math.min(Number(userInfo.solverLimit), (jobSolvers || []).length);
            const solvers = manager.getIdleSolvers(neededResources); 
            if(solvers && neededResources > 0)
            {
                await helpers.query("UPDATE `jobs` SET `status` = '1', `startTime` = ? WHERE `id` = ?", [
                    Date.now(),
                    job.id,
                ]);
                solvers.forEach(async (solver, i) => {
                    const target = jobSolvers[i];
                    const [dataContent, modelContent] = await Promise.all([
                        helpers.publishAndWait("read-file", "read-file-response", 0, {
                            fileId: target.dataID,
                        }, -1),
                        helpers.publishAndWait("read-file", "read-file-response", 0, {
                            fileId: target.modelID,
                        }, -1),
                    ]);
                    if(!dataContent.error && !modelContent.error)
                    {
                        solver.busy = true;
                        solver.jobID = job.id;
    
                        publish("solve", {
                            solverID: solver.id,
                            problemID: job.id,
                            data: dataContent.data,
                            model: modelContent.data,
                            solver: false,
                            flagS: false,
                            flagF: false,
                        });
                    }
                });
            }else if(neededResources === 0)
            {
                await helpers.query("UPDATE `jobs` SET `status` = '2', `endTime` = ? WHERE `id` = ?", [
                    Date.now(),
                    job.id,
                ]);
                publish("queue-check", {}); // Go to next element in queue
            }
        }
    }
}

export async function jobFinished(msg, publish){
    let solver = manager.getSolver(msg.solverID);
    if(solver)
    {
        solver.busy = false;
    }
    await helpers.query("INSERT INTO `jobOutput` (`content`, `jobID`) VALUES (?, ?)", [
        JSON.stringify(msg.data), // TODO: Dont just stringify it
        msg.problemID
    ]);

    const solvers = manager.getBusySolvers(msg.problemID);
    if(solvers.length === 0)
    {
        await helpers.query("UPDATE `jobs` SET `status` = '2', `endTime` = ? WHERE `id` = ?", [
            Date.now(),
            msg.problemID,
        ]);
        publish("queue-check", {});
    }
}

export async function jobHistory(msg, publish){
    const data = await helpers.query("SELECT * FROM `jobs` WHERE `userID` = ? ORDER BY `id` DESC LIMIT 50", [
        msg.userID // Should be token userID?
    ]);
    publish("job-history-response", {
        data: data || [],
    });
}

export async function solverHealth(msg, publish){
    let solver = manager.getSolver(msg.solverID);
    if(!solver)
    {
        solver = manager.newSolver(msg.solverID, msg.problemID);
        console.log("Discovered new solver #", msg.solverID, solver);
    }else{
        console.log("Solver alive", msg.solverID, solver);
        solver.busy = msg.problemID !== -1;
    }

    solver?.healthUpdate();
    if(msg.respond)
    {
        helpers.publish("solver-ping", {
            solverID: msg.solverID, 
        });
    }
}

if(process.env.RAPID)
{
    subscriber(host, [
        {river: "jobs", event: "add-job", work: addJob}, // Adds a new job
        {river: "jobs", event: "queue-check", work: queueCheck}, // Runs the next job in the queue, if there is any
        {river: "jobs", event: "job-history", work: jobHistory}, // Gets the job history of a user
        {river: "jobs", event: "solver-response", work: jobFinished}, // A solver has answered
        
        // Solver manager stuff
        {river: "jobs", event: "solver-pong-response", work: solverHealth}, // Response of a solver health check
    ]);
}
