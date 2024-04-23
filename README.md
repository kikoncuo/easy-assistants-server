# OmniAssistant Server

OmniAssistant Server is a powerful and flexible application built using Bun, TypeScript, and the LangChain library. It allows you to create and manage various agents, each specialized in different tasks and equipped with a set of tools to assist in completing those tasks. The server communicates with clients through WebSockets, enabling real-time communication and collaboration.

## Features

- **Agent Management**: Create and manage multiple agents, each with its own specialized task and set of tools.
- **Tool Integration**: Integrate various tools into agents, such as calculators, email clients, campaign management tools, and more.
- **Real-time Communication**: Communicate with clients through WebSockets for efficient and real-time interactions.
- **Task Processing**: Process and delegate tasks to the appropriate agents, leveraging their specialized knowledge and tools.
- **User Interaction**: Interact with users through prompts, allowing agents to gather necessary information for task completion.

## Getting Started

To get started with OmniAssistant Server, follow these steps:

1. **Clone the Repository**

```bash
git clone https://github.com/your-username/omni-assistant-server.git
cd omni-assistant-server
```

## Install Dependencies

```bash
bun install
```

## Set up Environment Variables

Create a .env file in the root directory of the project and add any required environment variables, such as API keys or credentials.

IE:

```bash
# .env
OPENAI_API_KEY=sk-*****
LANGCHAIN_API_KEY=ls__******
LANGCHAIN_PROJECT=multi-assistant-omniloy
LANGCHAIN_TRACING_V2=true
GROQ_API_KEY=gsk_******
ANTHROPIC_API_KEY=sk-ant-api03-******
```

## Build the Project (Optional)

If you need to build the project, run:

```bash
bun run build
```

## Start the Server

```bash
bun start
```

This will start the WebSocket server on port 8080.

## Usage

To interact with the server, you can use the provided `client.ts` file or create your own client application. The server accepts JSON-formatted messages with the following structure:

```json
{
  "type": "query",
  "task": "your task description"
}
```

The server will process the task and delegate it to the appropriate agent based on the task description. If the agent requires user input or additional information, the server will send a message back to the client with the necessary prompts.

Example client message:

```json
{
  "type": "query",
  "task": "create a new campagin targetting males over 40 years old, with a discount of 20% in all products. Include an email explaining the discount."
}
```

The server will respond with prompts for the required information, and the client should send back the responses for each prompt.

## Details on server communication

The server can send back messages with different types to the client, and the client should handle these messages accordingly. Here's an explanation of the different types and how they are handled in the provided client.ts example:

- plan step:
  The plan step type is used to show the plan or intermediate steps of the user's task to the user.
  This type is typically displayed to the user as is, without requiring any additional input or response.
- result:
  The result type is used to show the final response or output of the chat.
  In the provided example, the client handles the result type as follows:

```javascript
if (data.type === 'result') {
  // Server has sent a result
  console.log('Result:', data.message);
}
```

When the server sends a message with type set to result, the message field contains the final result or output, which is printed to the console in this example.

- tool:
  The tool type is used by the AI to request the user to run specific tools and provide a response.
  These tool requests should be handled sequentially by the client.
  The server sends a message with type set to tool, containing an array of functions that need to be processed.
  In the provided example, the client handles the tool type as follows:

```javascript
if (data.type === 'tool') {
  // Server is querying the user for input

  const { functions } = data;

  console.log('Server is querying for functions:', functions);

  // Process each function and send the responses back to the server
  const responses = functions.map(({ function_name, arguments: args }) => {
    console.log(`Processing function: ${function_name} with args:`, args);

    // Replace this with your own input mechanism or automated response logic
    let response;

    // Simplified example: Prompt the user for a response. Here you'd take the params, args and invoke your gunction
    response = prompt(`Enter your response for ${function_name}:`);

    return { function_name, response };
  });

  // Send the responses back to the server
  ws.send(JSON.stringify({ type: 'toolResponse', response: JSON.stringify(responses) }));
}
```

In this example, the client processes each function received from the server, prompts the user for a response (using the prompt function as a placeholder), and sends the responses back to the server in the format { type: 'toolResponse', response: JSON.stringify(responses) }.
The actual implementation of how the user input is obtained can be replaced with your own input mechanism or automated response logic.

By handling these different message types, the client can effectively communicate with the server, provide user input when requested (through tools), and display the final result or output.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.
