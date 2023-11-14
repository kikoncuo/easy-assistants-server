const openaiService = require('../openai/openaiService');
const logger = require('../utils/logger');

async function handleChatRequest(req, res) {
    try {
        const { query: userQuery, threadId, tool_outputs: toolOutputs, instructions } = req.body;
        const response = await openaiService.getAssistantResponse(userQuery, threadId, toolOutputs, instructions);
        res.json(response);
    } catch (error) {
        // Log the error with or without threadId based on its availability
        const threadId = req.body.threadId;
        logger.logWithThreadId('error', `Error in AI chat: ${error}`, threadId || null);
        res.status(500).send('Error processing chat request');
    }
}

module.exports = {
    handleChatRequest,
};
