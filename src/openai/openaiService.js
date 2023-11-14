const OpenAI = require('openai');
const logger = require('../utils/logger');
const handleToolProcesses = require('./openaiServerToolsHandler');
const { getToolResponse, deleteToolResponse } = require('../data/toolsResponsesData');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function createThreadIfNeeded(threadId) {
    if (threadId) {
        return { id: threadId };
    }
    return await openai.beta.threads.create();
}

/*async function handleActionResponse(threadId, toolResponses) {
    const toolOutputs = toolResponses.responses.map(response => ({
        tool_call_id: response.tool_call_id,
        output: response.output
    }));

    const resRun = await openai.beta.threads.runs.submitToolOutputs(
        threadId,
        toolResponses.runId,
        { tool_outputs: toolOutputs }
    );

    return resRun.id;
}*/


async function handleActionResponse(threadId, toolResponses) {
    const existingResponses = getToolResponse(toolResponses.runId) || [];
    const combinedResponses = [...existingResponses, ...toolResponses.responses];

    const toolOutputs = combinedResponses.map(response => ({
        tool_call_id: response.tool_call_id,
        output: response.output
    }));

    const resRun = await openai.beta.threads.runs.submitToolOutputs(
        threadId,
        toolResponses.runId,
        { tool_outputs: toolOutputs }
    );

    // Clean up the map after submitting tool outputs
    deleteToolResponse(toolResponses.runId);

    return resRun.id;
}

async function handleRegularMessage(threadId, userQuery, instructions = null) {
    await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: userQuery
    });

    const runPayload = { 
        assistant_id: process.env.ASSISTANT_ID
    };

    if (instructions) {
        runPayload.instructions = instructions;
    } else {
        // Here for easier testing, this should live on the assistants interface or passed as a parameter only
        /*const baseInstructions = "Ask the user questions about what they would like to use their computer for...";
        const websiteData = "The cart URL is http://localhost:3000/cart";
        runPayload.instructions = baseInstructions + "Product information: " + JSON.stringify(productsData) + "\n\nWebsite data: " + websiteData;*/
    }

    const run = await openai.beta.threads.runs.create(threadId, runPayload);

    return run.id;
}

async function checkRunStatus(threadId, runId) {
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
    while (runStatus.status === "in_progress" || runStatus.status === "queued") {
        await new Promise(resolve => setTimeout(resolve, 500));
        runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
    }
    return runStatus;
}


async function getAssistantResponse(userQuery, threadId = null, toolResponses = null, instructions = null) {
        try {
        const thread = await createThreadIfNeeded(threadId);
        threadId = thread.id;

        logger.logWithThreadId('info', `New call performed - User Query: ${userQuery}, Tool Outputs: ${JSON.stringify(toolResponses)}`, threadId);

        let runID = userQuery === "action_response" 
            ? await handleActionResponse(threadId, toolResponses) 
            : await handleRegularMessage(threadId, userQuery, instructions);

        const runStatus = await checkRunStatus(threadId, runID);
        logger.logWithThreadId('info', `Run Status: ${runStatus.status}`, threadId);

        if (runStatus.status === "requires_action") {
            const run = await openai.beta.threads.runs.list(threadId);
            let toolCalls = run.body.data[0].required_action.submit_tool_outputs.tool_calls;
    
            const allToolsHandled = await handleToolProcesses(toolCalls, runID);
            if (allToolsHandled) {
                handleActionResponse(threadId, { runId:runID, responses: [/*Empty because handleActionResponse will read them from the temp storage*/] });
                // Re-check the run status after handling all tool processes
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait for the tool responses to be sent to the assistant and go to a different processing state
                const runStatusAfterTools = await checkRunStatus(threadId, runID);
                logger.logWithThreadId('info', `Run Status afterRunning actions: ${runStatusAfterTools.status}`, threadId);
            } else {
                const existingResponses = getToolResponse(runID) || [];
                logger.logWithThreadId('info', `AI requires action response from client, sending toolCall - Tool Calls: ${JSON.stringify(toolCalls)}`, threadId);
                return { 
                    responseContent: "requires_action", 
                    threadId: threadId, 
                    tools: { 
                        calls: toolCalls.filter(toolCall => !existingResponses.some(response => response.tool_call_id === toolCall.id)), 
                        runID 
                    } 
                };
            }
        }

        const messages = await openai.beta.threads.messages.list(threadId);
        const lastMessage = messages.data.find(msg => msg.role === 'assistant');
        const responseContent = lastMessage ? lastMessage.content : "No response from the assistant.";
        logger.logWithThreadId('info', `Response Content: \n${responseContent}`, threadId);
        return { responseContent, threadId: threadId };

    } catch (error) {
        logger.logWithThreadId('error', `Error in OpenAI service: ${error.message}`, threadId);
        logger.logWithThreadId(JSON.stringify(error, null, 2));
        throw error; // Rethrow the error for the calling function to handle
    }
}

module.exports = {
    getAssistantResponse,
};
