const openaiService = require('../openai/openaiService');
const logger = require('../utils/logger');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client if URL and key are provided
const isSupabaseEnabled = process.env.SUPABASE_URL && process.env.SUPABASE_KEY;
let supabase;
if (isSupabaseEnabled) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  logger.log('info', 'Supabase client initialized, chat data will be saved to Supabase');
}

async function saveChatDataToSupabase(userQuery, toolOutputs, response) {
  const messages = [];
  const threadId = response.threadId;

  if (!toolOutputs || !toolOutputs.calls || toolOutputs.calls.length === 0) {
    messages.push({ thread_id: threadId||1, role: 'user', content: userQuery });
  }

  if (toolOutputs && toolOutputs.calls && toolOutputs.calls.length > 0) {
    for (const call of toolOutputs.calls) {
      const functionDetails = call.function;
      if (functionDetails && functionDetails.name) {
        messages.push({
          thread_id: threadId,
          role: 'function',
          content: JSON.stringify(functionDetails.arguments),
          function_name: functionDetails.name,
          function_arguments: functionDetails.arguments
        });
      }
    }
  }

  if (response) {
      if (response.responseContent === 'text'|| response.responseContent[0].type === 'text') {
        messages.push({ thread_id: threadId, role: 'assistant', content: response.responseContent[0].text.value });
      } else if (response.responseContent === 'requires_action') {
        // for each call in response.tools.calls store a message
        for (const call of response.tools.calls) {
          const functionDetails = call.function;
          if (functionDetails && functionDetails.name) {
            messages.push({
              thread_id: threadId,
              role: 'assistant',
              content: 'function_call',
              function_name: functionDetails.name,
              function_arguments: functionDetails.arguments
            });
          }
        }
      }
  }

  if (isSupabaseEnabled) {
    const storeRes = await supabase.from('chat_data').insert(messages);
    if (storeRes.error) {
        logger.log('error', JSON.stringify(storeRes, null, 2));
    }
  }
}

async function handleChatRequest(req, res) {
  try {
    const { query: userQuery, threadId, tool_outputs: toolOutputs, instructions } = req.body;
    
    const response = await openaiService.getAssistantResponse(userQuery, threadId, toolOutputs, instructions);

    if (isSupabaseEnabled) {
      await saveChatDataToSupabase(userQuery, toolOutputs, response);
    }

    res.json(response);
  } catch (error) {
    const threadId = req.body.threadId;
    logger.logWithThreadId('error', `Error in AI chat: ${error}`, threadId || null);
    res.status(500).send('Error processing chat request');
  }
}

module.exports = {
  handleChatRequest,
};
