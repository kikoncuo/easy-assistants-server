const logger = require('../utils/logger');
const { getToolResponse, setToolResponse } = require('../data/toolsResponsesData');
const testtool = require('../tools/testTool');



const functionMap = {
    // Add any functions here imported from anywhere, make sure that you define a function with the same name and params in openAI assistant's
    testTool: testtool.testFunction,
};
  

async function handleToolProcesses(toolCalls, runId) {
  let responses = getToolResponse(runId) || [];

  for (const toolCall of toolCalls) {
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');

    try {
      logger.logWithThreadId('info', `${functionName} called with parameters: ${JSON.stringify(args)}`, "");

      // Call the function dynamically from the functionMap
      if (functionMap[functionName]) {
        const result = await functionMap[functionName](...Object.values(args));
        logger.logWithThreadId('debug', `Result of the call is ${JSON.stringify(result)}`, "");
        responses.push({ tool_call_id: toolCall.id, output: `Success: ${JSON.stringify(result)}` });
      } else {
        logger.logWithThreadId('debug', `Unidentified tool, likely a client tool ${functionName}: ${JSON.stringify(args)}`, "");
      }
    } catch (error) {
        logger.logWithThreadId('error', JSON.stringify(error), "");
        logger.logWithThreadId('error', error.message, "");
        responses.push({ tool_call_id: toolCall.id, output: `Error: ${error.message}` });
    }
  }

  setToolResponse(runId, responses);

  return responses.length === toolCalls.length;
}

module.exports = handleToolProcesses;
