import helpers from "./helpers.js";
import SolverManager from "./SolverManager.js";
export const manager = new SolverManager();

/*
{
    userID: number,
    modelID: number,
    dataID: number,
    
}
*/
export async function addJob(msg, publish){
    const stmt = await helpers.query("INSERT INTO `jobs` (`userID`, `dataID`, `modelID`) VALUES (?, ?, ?)", [
        msg.userID,
        msg.dataID,
        msg.modelID
    ]);
    
    const jobID = stmt?.insertId;
    if(jobID)
    {
        for(let i = 0; i < msg.solvers.length; i++)
        {
            const solver = msg.solvers[i];
            await helpers.query("INSERT INTO `jobParts` (`solverID`, `cpuLimit`, `timeLimit`, `memoryLimit`, `flagS`, `flagF`, `jobID`) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                solver.solverID,
                solver.cpuLimit,
                solver.timeLimit,
                solver.memoryLimit,
                solver.flagA,
                solver.flagF,
                jobID,
            ]);
        }
    }

    publish("add-job-response", {
        error: !jobID,
    });
    publish("queue-check", {});
}

export async function removeJob(msg, publish){
    let check = !msg.userID;
    if(!check) // Has userID, verify its this user's job
    {
        const checkStmt = await helpers.query("SELECT `id` FROM `jobs` WHERE `userID` = ?", [
            msg.userID
        ]);
        check = checkStmt && checkStmt.length > 0;
    }

    if(check)
    {
        await helpers.query("DELETE FROM `jobOutput` WHERE `jobID` = ?", [msg.id]);
        await helpers.query("DELETE FROM `jobParts` WHERE `jobID` = ?", [msg.id]);
        await helpers.query("DELETE FROM `jobs` WHERE `id` = ?", [msg.id]);
        
        publish("stopSolve", { // Stop other solvers working on this problem
            problemID: msg.id
        });
    }

    publish("remove-job-response", {
        error: check,
    });
}

export async function queueCheck(_, publish){
    const queue = await helpers.query("SELECT * FROM `jobs` WHERE `status` = '0' ORDER BY `id` ASC LIMIT 1");
    console.log("Queue check", queue.length, "in queue");
    
    if(queue && queue.length > 0)
    {
        const job = queue[0];
        const {data: userInfo} = await helpers.publishAndWait("getUser", "getUser-response", -1, {
            id: job.userID,
        }, -1);
        if(userInfo)
        {
            const jobSolvers = await helpers.query("SELECT * FROM `jobParts` WHERE `jobID` = ? ORDER BY `id` DESC", [
                job.id,
            ]);
            const neededResources = Math.min(Number(userInfo.solverLimit), (jobSolvers || []).length);
            const solvers = manager.getIdleSolvers(neededResources); 
            console.log("Starting solvers", neededResources);
            if(solvers && neededResources > 0)
            {
                const [dataContent, modelContent] = await Promise.all([
                    helpers.publishAndWait("read-file", "read-file-response", -1, {
                        fileId: job.dataID,
                    }, -1),
                    helpers.publishAndWait("read-file", "read-file-response", -2, {
                        fileId: job.modelID,
                    }, -1),
                ]);

                const {solvers: allSolvers} = await Promise.any([ // Double poke
                    helpers.publishAndWait("list-solvers", "list-solvers-response", -1, {}, -1),
                    // helpers.publishAndWait("list-solvers", "list-solvers-response", -2, {}, -1),
                ]);
                

                // return;
                await helpers.query("UPDATE `jobs` SET `status` = '1', `startTime` = ? WHERE `id` = ?", [
                    Date.now(),
                    job.id,
                ]);

                solvers.forEach(async (solver, i) => {
                    const target = jobSolvers[i];
                    const targetSolver = allSolvers.find(s => s.id === target.solverID);

                    if(!dataContent.error && !modelContent.error)
                    {
                        solver.busy = true;
                        solver.jobID = job.id;
    
                        const memoryLimit = Number(target.memoryLimit);
                        const timeLimit = Number(target.timeLimit);
                        const cpuLimit = Number(target.cpuLimit);

                        publish("solve", {
                            solverID: solver.id,
                            problemID: job.id,
                            data: dataContent.data,
                            model: modelContent.data,
                            solver: targetSolver.name,
                            dockerImage: targetSolver.docker_image,

                            flagS: Number(target.flagS),
                            flagF: Number(target.flagF),

                            cpuLimit: cpuLimit === 0 ? false : cpuLimit,
                            timeLimit: timeLimit === 0 ? false : timeLimit,
                            memoryLimit: memoryLimit === 0 ? false : (memoryLimit + "m"),
                        });
                    }
                });
            }else if(neededResources === 0)
            {
                console.log("No neededResources!");
                await helpers.query("UPDATE `jobs` SET `status` = '2', `endTime` = ? WHERE `id` = ?", [
                    Date.now(),
                    job.id,
                ]);
                publish("queue-check", {}); // Go to next element in queue
            }
        }

        publish("logIt", {userId: -1});
    }
}

export async function jobFinished(msg, publish){
    let solver = manager.getSolver(msg.solverID);
    if(solver)
    {
        solver.busy = msg.busy;
    }

    await helpers.query("INSERT INTO `jobOutput` (`content`, `jobID`) VALUES (?, ?)", [
        JSON.stringify(msg.data),
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
    publish("logIt", {userId: -1});
}

export async function jobHistory(msg, publish){
    const data = await helpers.query("SELECT * FROM `jobs` WHERE `userID` = ? ORDER BY `id` DESC LIMIT 50", [
        msg.userID // Should be token userID?
    ]);
    publish("job-history-response", {
        data: data || [],
    });
}

export async function jobOutput(msg, publish){
    const data = await helpers.query("SELECT * FROM `jobOutput` WHERE `jobID` = ?", [
        msg.id,
    ]);

    publish("job-output-response", {
        data: data && data.length > 0 ? data[0] : false,
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
    
    console.log("Now has", manager.solvers, "solvers", msg);
    solver?.healthUpdate();
    if(msg.respond)
    {
        publish(helpers.host, "solver-ping", {
            solverID: msg.solverID, 
        });

    }
}

if(process.env.RAPID)
{
    helpers.subscriber(helpers.host, [
        {river: "jobs", event: "add-job", work: addJob}, // Adds a new job
        {river: "jobs", event: "remove-job", work: removeJob}, // Removes a new job
        {river: "jobs", event: "queue-check", work: queueCheck}, // Runs the next job in the queue, if there is any
        {river: "jobs", event: "job-history", work: jobHistory}, // Gets the job history of a user
        {river: "jobs", event: "job-output", work: jobOutput}, // Gets the output of a job
        {river: "jobs", event: "solver-response", work: jobFinished}, // A solver has answered
        
        // Solver manager stuff
        {river: "jobs", event: "solver-pong-response", work: solverHealth}, // Response of a solver health check
    ]);
}
