const openaiService = require('../openai/openaiService');
const logger = require('../utils/logger');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client if URL and key are provided
const isSupabaseEnabled = process.env.SUPABASE_URL && process.env.SUPABASE_KEY;
let supabase;
if (isSupabaseEnabled) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

async function saveChatDataToSupabase(threadId, userQuery, toolOutputs, responseContent) {
  // Prepare the messages array to be inserted into Supabase
  const messages = [];

  // Add user query to messages array only if it's a regular query (not a tool function call)
  if (!toolOutputs || !toolOutputs.calls || toolOutputs.calls.length === 0) {
    messages.push({ role: 'user', content: userQuery });
  }

  // Process the tool function responses
  if (toolOutputs && toolOutputs.calls && toolOutputs.calls.length > 0) {
    for (const call of toolOutputs.calls) {
      const functionDetails = call.function;
      if (functionDetails && functionDetails.name) {
        // Add function response to messages array
        messages.push({ role: 'function', name: functionDetails.name, content: functionDetails.arguments });
      }
    }
  }

  // Process the assistant's response content
  if (responseContent && responseContent.length > 0) {
    for (const content of responseContent) {
      if (content.type === 'text') {
        // Add assistant's text response to messages array
        messages.push({ role: 'assistant', content: content.text.value });
      } else if (content.type === 'function_call') {
        // Add assistant's function call to messages array
        messages.push({
          role: 'assistant',
          function_call: {
            name: content.function_call.name,
            arguments: JSON.stringify(content.function_call.arguments)
          }
        });
      }
    }
  }

  // Save messages to Supabase if client is initialized
  if (isSupabaseEnabled) {
    await supabase.from('chat_data').insert({ thread_id: threadId, messages });
  }
}

async function handleChatRequest(req, res) {
  try {
    const { query: userQuery, threadId, tool_outputs: toolOutputs, instructions } = req.body;
    const response = await openaiService.getAssistantResponse(userQuery, threadId, toolOutputs, instructions);

    // Save chat data to Supabase if enabled
    if (isSupabaseEnabled) {
      await saveChatDataToSupabase(threadId, userQuery, toolOutputs, response.responseContent);
    }

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