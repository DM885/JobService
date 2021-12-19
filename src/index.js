import {host, query, subscriber, publishAndWait} from "./helpers.js";
import SolverManager from "./SolverManager.js";
const manager = new SolverManager();

/*
{
    userID: number,
    modelID: number,
    dataID: number,
    
}
*/
export async function addJob(msg, publish){
    const stmt = await query("INSERT INTO `jobs` (`userID`, `dataID`, `modelID`, `solverID`, `cpuLimit`, `memoryLimit`, `flagS`, `flagF`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
        msg.userID,
        msg.dataID,
        msg.modelID,
        msg.solverID,
        msg.cpuLimit,
        msg.memoryLimit,
        msg.flagS,
        msg.flagF,
    ]);

    publish("add-job-response", {
        error: !!stmt,
    });
    publish("queue-check", {});
}

export async function queueCheck(_, publish){
    const queue = await query("SELECT * FROM `jobs` WHERE `status` = '0' ORDER BY `id` ASC LIMIT 1");
    console.log("Queue check", queue.length, "in queue");
    
    if(queue && queue.length > 0)
    {
        const job = queue[0];

        const {data: userInfo} = await publishAndWait("getUser", "getUser-response", 0, {
            id: job.userID,
        }, -1);
        if(userInfo)
        {
            const neededResources = Math.min(Number(userInfo.solverLimit), (jobSolvers || []).length);
            const solvers = manager.getIdleSolvers(neededResources); 
            if(solvers && neededResources > 0)
            {
                const [dataContent, modelContent, allSolvers] = await Promise.all([
                    publishAndWait("read-file", "read-file-response", 0, {
                        fileId: job.dataID,
                    }, -1),
                    publishAndWait("read-file", "read-file-response", 0, {
                        fileId: job.modelID,
                    }, -1),
                    publishAndWait("list-solvers", "list-solvers-response", 0, {}, -1),
                ]);

                const targetSolver = allSolvers.find(s => s.id === job.solverID);
                
                solvers.forEach(async (solver, i) => {
                    // const target = jobSolvers[i];
                    if(!dataContent.error && !modelContent.error)
                    {
                        solver.busy = true;
                        solver.jobID = job.id;
    
                        publish("solve", {
                            solverID: solver.id,
                            problemID: job.id,
                            data: dataContent.data,
                            model: modelContent.data,
                            solver: targetSolver.name,
                            dockerImage: targetSolver.docker_image,

                            flagS: Number(job.flagS),
                            flagF: Number(job.flagF),

                            cpuLimit: job.cpuLimit,
                            memoryLimit: job.memoryLimit + "m",
                        });
                    }
                });
                
                await query("UPDATE `jobs` SET `status` = '1', `startTime` = ? WHERE `id` = ?", [
                    Date.now(),
                    job.id,
                ]);
            }else if(neededResources === 0)
            {
                await query("UPDATE `jobs` SET `status` = '2', `endTime` = ? WHERE `id` = ?", [
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
    await query("INSERT INTO `jobOutput` (`content`, `jobID`) VALUES (?, ?)", [
        JSON.stringify(msg.data), // TODO: Dont just stringify it
        msg.problemID
    ]);

    const solvers = manager.getBusySolvers(msg.problemID);
    if(solvers.length === 0)
    {
        await query("UPDATE `jobs` SET `status` = '2', `endTime` = ? WHERE `id` = ?", [
            Date.now(),
            msg.problemID,
        ]);
        publish("queue-check", {});
    }
}

export async function jobHistory(msg, publish){
    const data = await query("SELECT * FROM `jobs` WHERE `userID` = ? ORDER BY `id` DESC LIMIT 50", [
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
    
    solver.healthUpdate();
    if(msg.respond)
    {
        publish(host, "solver-ping", {
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
