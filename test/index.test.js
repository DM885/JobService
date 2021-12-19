import {afterAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {addJob, jobFinished, queueCheck, jobHistory, solverHealth} from '../src/index.js';
import helpers from '../src/helpers.js';

const sessionId = 1;
const requestId = 1;
const userId = 1;

helpers.query = jest.fn();
const publishFn = jest.fn();

describe("JobService Tests", () => {
    beforeEach(async () => {
        helpers.query.mockClear();
        publishFn.mockClear();
    })

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
})