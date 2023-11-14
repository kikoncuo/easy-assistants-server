# README.md for Server Setup and Usage

## 🚀 Getting Started

This guide explains how to set up and use the server which integrates with OpenAI's services to handle user queries and manage a chat interface.

### Prerequisites

- Node.js installed
- dotenv, express, openai, and winston npm packages
- An OpenAI API key

### Installation

1. Clone the repository.
2. Navigate to the project directory.
3. Run `npm install` to install dependencies.

## 🛠️ Configuration

Create a `.env` file in the root directory and add your OpenAI API key:

```dotenv
PORT=3001
OPENAI_API_KEY=your_api_key_here
ASSISTANT_ID=asst_id_here
```

## 🖥️ Running the Server

Start the server by running:

bash

npm start

The server will be running on http://localhost:3001 or a custom port if defined in .env.
## 🔌 API Endpoints
POST /chat

    Description: Handles user queries and manages chat interactions.
    Request Body:
        query: The user's query or message.
        threadId: (Optional) The thread ID for continuing an existing conversation.
        tool_outputs: (Optional) Outputs from tools required for processing the query.

### Sending a New Query

 ```json
POST /chat
{
  "query": "I'm looking for a gaming laptop."
}
```

Return Values

A regular response contains the assistant's text response to the user query. And a threadId to keep the conversation
    Example:

    Structure: { responseContent: string, threadId: string }

 ```json
    {
      "responseContent": "Here are some gaming laptops...",
      "threadId": "thread_AWwEcT5YpdJoD0PDsYdrmvHk"
    }
```

### Continuing a Conversation

To continue a conversation we need to pass a threadId, the threadId is returned as the response to any message, we recommend you manage those within your app state or sometimes in localstorage (Remember clearing it if you use localstorage)

 ```json
POST /chat
{
  "query": "What about laptops for video editing?",
  "threadId": "thread_AWwEcT5YpdJoD0PDsYdrmvHk"
}
```

### Passing custom instructions

Sometimes we'll want to give the AI extra context or custom instructions other than the base defined through the assistants UI, we can do that by passing the instructions parameter

 ```json
POST /chat
{
  "query": "What about laptops for video editing?",
  "threadId": "thread_AWwEcT5YpdJoD0PDsYdrmvHk",
  "instructions": "Continue helping the user find the best laptop. They are currently viewing the following data EXAMPLEDATA"
}
```

### Handling Tools 

Requires Action Response

Sometimes a response may be a request to perform a call, the functions are pre-defined with the AI and depend on the assistant that has been created. The assistant requires a response to the function to proceed and provide the response

    Structure: { responseContent: "requires_action", threadId: string, tools: { calls: Array, runID: string } }
    
 Example:

 ```json
    {
      "responseContent": "requires_action",
      "threadId": "thread_AWwEcT5YpdJoD0PDsYdrmvHk",
      "tools": {
        "calls": [
            {
                "function": {
                    "name":"navigate",
                    "arguments":"http://google.com"
                },
                "id": "call_9C0aEJwogmakZy9ncSWOiJht"
            }
        ],
        "runID": "run_14T1HJZoHFrSqr3nrvKsgwwQ"
      }
    }
```

Here is an example of how a reponse to an action can be provided. Keep in mind that a message may request the execution of multiple tools

```json
POST /chat
{
  "query": "action_response",
  "threadId": "thread_AWwEcT5YpdJoD0PDsYdrmvHk",
  "tool_outputs": {
    "responses": [
      {
        "tool_call_id": "call_9C0aEJwogmakZy9ncSWOiJht",
        "output": "success"
      }
    ],
    "runId": "run_14T1HJZoHFrSqr3nrvKsgwwQ"
  }
}
```

## 🧰 Setting up and handling custom server-side tools

Custom server-side tools can be integrated and managed to extend the functionality of the chat interface. The openaiServerToolsHandler.js file is central to this process. Below is an example of how to modify this file to handle custom server-side tools:

javascript

const logger = require('../utils/logger');
const { getToolResponse, setToolResponse, deleteToolResponse } = require('../data/toolsResponsesData');

async function handleToolProcesses(toolCalls, runId) {
    let responses = getToolResponse(runId) || [];

    for (const toolCall of toolCalls) {
        // Handle specific tools as needed
        if (toolCall.function.name === "testTool") {
            // Log the function name and the parameters
            logger.logWithThreadId('info', `${toolCall.function.name} called with parameters: ${toolCall.function.arguments}`);
            // Always add your response to the tool here
            responses.push({ tool_call_id: toolCall.id, output: "Test Successful" });
        }
    }

    setToolResponse(runId, responses);

    if (responses.length === toolCalls.length) {
        return true; // All tools have been handled
    }

    return false; // Some tools are still pending
}

module.exports = handleToolProcesses;

Server-side tools are designed to work in tandem with client tools automatically. However, if a client tool and a server tool are invoked in the same response to a user message, synchronization is managed in toolsResponsesData.js. Currently, this synchronization uses a Map object.
Note on Persistent Data Store

If your code operates in a serverless environment or any scenario where the run state could be lost from memory, consider transitioning to a persistent data store. This change will ensure that the state of tool responses remains consistent across different instances or invocations of your server.

## 🌟 Features

    Integration with OpenAI for natural language processing.
    Thread management for continuous conversation flow.
    Custom instructions per message.
    Interface to handle tool execution and responses on server and client.
    Simultaneous client and server tool execution.
    Logging with Winston for error tracking and info logs.

## 📚 Additional Information

    For detailed API documentation, refer to OpenAI's official API docs.
    Ensure your OpenAI API key remains confidential.
    Adjust logging levels as needed in production environments.

## 📞 Support

For any issues or queries, ask Enrique.