// This needs to be updated in production to use persistant data storage and should auto delete records which are older than a few hours

let toolResponsesMap = new Map();

function setToolResponse(runId, responses) {
    toolResponsesMap.set(runId, responses);
}

function getToolResponse(runId) {
    return toolResponsesMap.get(runId);
}

function deleteToolResponse(runId) {
    toolResponsesMap.delete(runId);
}

module.exports = {
    setToolResponse,
    getToolResponse,
    deleteToolResponse
};
