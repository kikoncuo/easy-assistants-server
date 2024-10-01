// LLMResponseHandler.ts
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, isAIMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';

interface LLMResponseHandlerState {
  messages: (HumanMessage | AIMessage | SystemMessage | ToolMessage)[];
}

type ToolHandlerType = (args: any, toolCallId: string, state: any) => Promise<Partial<any>>;

export class LLMResponseHandler {
  private functions: Function[];
  private toolHandlers: { [toolName: string]: ToolHandlerType };

  constructor(functions: Function[], toolHandlers?: { [toolName: string]: ToolHandlerType }) {
    this.functions = functions;
    this.toolHandlers = toolHandlers || {};
  }

  async initializeMessages(task: string, messages: (HumanMessage | AIMessage | SystemMessage)[]) {
    if (!messages || messages.length === 0) {
      if (task && task.trim() !== '') {
        messages = [
          new SystemMessage(`You are a technical business analyst that makes plans.
          You know that you have access to a table called customers with fields for ID, name, total lifetime value, and last transaction date.
          The user may ask you to update the plan as a response to the tool.`),
          new HumanMessage(task),
        ];
      } else {
        throw new Error('No messages or task provided to the model.');
      }
    }
    return messages;
  }

  async processResponse(state: any, model: any, config?: any): Promise<Partial<any>> {
    let { messages } = state;

    Logger.log('Calling Model');
    console.log(messages);

    // Invoke the model with the conversation history
    const response = await model.invoke(messages, config);

    // Add the AI response to messages
    messages.push(response);

    // Initialize state updates
    let stateUpdates: Partial<any> = {};

    // Handle AI tool calls
    if (
      isAIMessage(response) &&
      'tool_calls' in response &&
      Array.isArray(response.tool_calls) &&
      response.tool_calls.length > 0
    ) {
      for (const toolCall of response.tool_calls) {
        const { name, args, id } = toolCall;

        // Check if there's a custom handler for this tool
        if (this.toolHandlers[name] && id) {
          const handlerUpdates = await this.toolHandlers[name](args, id, state);
          // Merge handlerUpdates into stateUpdates
          stateUpdates = { ...stateUpdates, ...handlerUpdates };
        } else {
          // Default behavior: send the tool call to the user and get the response
          const userResponses = await this.functions[0]('tool', [
            {
              name,
              args,
            },
          ]);

          Logger.log('User response:', userResponses);

          // Process the user's response to the tool
          if (userResponses && id) {
            const toolMessage = new ToolMessage({
              content: JSON.stringify(userResponses),
              tool_call_id: id,
              name: name,
            });
            messages.push(toolMessage);
          }
        }
      }
    } else if (response.content) {
      // If there are no tool calls but there's content, send it to the user
      const userResponses = await this.functions[0]('tool', [{ name: 'messageRequest', text: response.content }]);
      if (userResponses && userResponses.messageRequest) {
        const userMessage = new HumanMessage(userResponses.messageRequest);
        messages.push(userMessage);
      }
    }

    console.log('Done with task', messages);
    // Return the new messages and any state updates
    return { messages: messages, ...stateUpdates };
  }
}
