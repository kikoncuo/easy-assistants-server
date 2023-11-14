const logger = require('../utils/logger');
const { getToolResponse, setToolResponse, deleteToolResponse } = require('../data/toolsResponsesData');

async function handleToolProcesses(toolCalls, runId) {
    let responses = getToolResponse(runId) || [];

    for (const toolCall of toolCalls) {
        // Additional logic if needed when a specific tool is handled
        if (toolCall.function.name === "testTool") {
            // Log the function name and the parametes
            logger.logWithThreadId('info', `${toolCall.function.name} called with parameters: ${toolCall.function.arguments}`);
            // Aways add your response to the tool here
            responses.push({ tool_call_id: toolCall.id, output: "Test Successfull" });
        }
    }
    setToolResponse(runId, responses);
    if (responses.length === toolCalls.length) {
        return true;
    }
    return false;
}

module.exports = handleToolProcesses;
