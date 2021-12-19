import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {manager, addJob, jobFinished, queueCheck, jobHistory, solverHealth} from '../src/index.js';
import helpers from '../src/helpers.js';

const sessionId = 1;
const requestId = 1;
const userId = 1;

helpers.query = jest.fn();
manager.getSolver = jest.fn();
manager.newSolver = jest.fn();
const publishFn = jest.fn();

describe("JobService Tests", () => {
    beforeEach(async () => {
        helpers.query.mockClear();
        manager.getSolver.mockClear();
        manager.newSolver.mockClear();
        publishFn.mockClear();
    })

    /** addJob() */
    it("Should query the database when adding a job in 'jobs'", async () => {
        //Call the addJob function.
        const msg = {sessionId: sessionId, requestId: requestId, userID: userId}
        await addJob(msg, publishFn);

        //Expect that the database has been queried. 
        expect(helpers.query).toHaveBeenCalledTimes(1);
    });

    it("Should query the database when adding a job in 'jobFiles'", async () => {
        // Mock the function return
        helpers.query.mockReturnValueOnce({insertId: 1});

        //Call the addJob function.
        const msg = {sessionId: sessionId, requestId: requestId, userID: userId, solvers: [{dataID: 1, modelID: 1, jobID: 1},
            {dataID: 2, modelID: 2, jobID: 2}, {dataID: 3, modelID: 3, jobID: 3}]}
        await addJob(msg, publishFn);


        //Expect that the database has been queried. 
        expect(helpers.query).toHaveBeenCalledTimes(4);
    });

    it("Should publish the correct response when adding a job in 'jobs'", async () => {
        // Mock the function return
        const jobs = [{id: 1, userID: userId, status: "foo", solvers: [{dataID: 1, modelID: 1, jobID: 1},
            {dataID: 2, modelID: 2, jobID: 2}, {dataID: 3, modelID: 3, jobID: 3}], insertId: 1}];
        helpers.query.mockReturnValueOnce(jobs);

        //Call the addJob function.
        const msg = {sessionId: sessionId, requestId: requestId, userID: userId, solvers: [{dataID: 1, modelID: 1, jobID: 1},
            {dataID: 2, modelID: 2, jobID: 2}, {dataID: 3, modelID: 3, jobID: 3}]}
        await addJob(msg, publishFn);

        //Expect that the database has been queried. 
        expect(publishFn).toHaveBeenCalledTimes(2);
        expect(publishFn).toHaveBeenNthCalledWith(1, 'add-job-response', {
            error: true
        });
        expect(publishFn).toHaveBeenNthCalledWith(2, 'queue-check', { }); // This should probably change.
    })

    /** jobFinished() */
    it("Should query the database when a job has finished", async () => {
        // Call the jobFinished function
        const msg = {sessionId: sessionId, requestId: requestId, userID: userId, solverID: 1, data: "foo", problemID: 1, job: {id: 1}}
        await jobFinished(msg, publishFn);

        //Expect that the database has been queried. 
        expect(helpers.query).toHaveBeenCalledTimes(2);
    });

    it("Should publish the correct response when a job has finished", async () => {
        // Call the jobFinished function
        const msg = {sessionId: sessionId, requestId: requestId, userID: userId, solverID: 1, data: "foo", problemID: 1, job: {id: 1}}
        await jobFinished(msg, publishFn);

        //Expect that the publish function has been called
        expect(publishFn).toHaveBeenCalledTimes(1);
        expect(publishFn).toHaveBeenCalledWith("queue-check", {});
    });

    /** jobhistory */
    it("Should query the database when requesting all previous jobs from user", async() => {
        const msg = {sessionId: sessionId, requestId: requestId, userID: userId}
    
        await jobHistory(msg, publishFn);

        expect(helpers.query).toHaveBeenCalledTimes(1);
    });
   
    it("Should publish the correct response when requestion a job history from a user", async() => {
        //mock the return
        const jobs = [{id: 1, userID: 3, status: 1, startTime: "today", endTime: "never" },
                    {id: 2, userID: 3, status: 1, startTime: "today", endTime: "never" }];
        
        helpers.query.mockReturnValueOnce(jobs);

        //call the jobHistory function
        const msg = {sessionId: sessionId, requestId: requestId, userID: 3}
        await jobHistory(msg, publishFn);

        expect(publishFn).toHaveBeenCalledTimes(1);
        expect(publishFn).toHaveBeenCalledWith("job-history-response", { "data": [
                {id: 1, userID: 3, status: 1, startTime: "today", endTime: "never" },
                {id: 2, userID: 3, status: 1, startTime: "today", endTime: "never" }
            ]
        });
    });

    /** solverHealth */
    it("Should call the getSolver function", async () => {
        //Call solverhealth function
        const msg = {sessionId: sessionId, requestId: requestId, solverID: 1, problemID: 1};
        await solverHealth(msg, publishFn);

        //Expect the functions to be called
        expect(manager.getSolver).toHaveBeenCalledTimes(1);
    })
    
    it("Should add new solver if no solver is found with specific ID", async () => {
        //Mock retur of getSolver
        manager.getSolver.mockReturnValueOnce(false);

        //Call solverHealth function
        const msg = {sessionId: sessionId, requestId: requestId, solverID: 1, problemID: 1};
        await solverHealth(msg, publishFn);

        //Expect the new solver function to have been called
        expect(manager.newSolver).toHaveBeenCalledTimes(1);
    });

    /** Queue check */
    it("Should query the jobs database in queuecheck", async () => {
    
    });

    it("Should query the jobFiles database in queuecheck if queue length > 0", async () => {
        
    });
})