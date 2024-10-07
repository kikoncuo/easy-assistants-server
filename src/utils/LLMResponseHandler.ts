// LLMResponseHandler.ts
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, isAIMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
interface LLMResponseHandlerState {
  messages: (HumanMessage | AIMessage | SystemMessage | ToolMessage)[];
}
export type ToolHandlerType = (args: any, toolCallId: string, state: any) => Promise<Partial<any>>;
export class LLMResponseHandler {
  private functions: Function[];
  constructor(functions: Function[]) {
    this.functions = functions;
  }
  async initializeMessages(task: string, systemPrompt:string, messages: (HumanMessage | AIMessage | SystemMessage)[]) {
    if (!messages || messages.length === 0) {
      if (task && task.trim() !== '') {
        messages = [
          new SystemMessage(systemPrompt),
          new HumanMessage(task),
        ];
      } else {
        throw new Error('No messages or task provided to the model.');
      }
    }
    return messages;
  }
  async processResponse(state: any, model: any, toolHandlers?: { [toolName: string]: ToolHandlerType } , config?: any): Promise<Partial<any>> {
    let { messages, plan, relevantTables, code, cellCount } = state;
    Logger.log('Calling Model');
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
        if(response.tool_calls.length > 0 && response.tool_calls[0].name === 'generatePlan') {
            plan = response.tool_calls[0].args.plan;
            stateUpdates = { ...stateUpdates, plan: plan };
        } else if (response.tool_calls.length > 0 && response.tool_calls[0].name === 'identifyRelevantTables') {
            relevantTables = response.tool_calls[0].args.relevantTables;
            stateUpdates = { ...stateUpdates, relevantTables: relevantTables };
        } else if (response.tool_calls.length > 0 && response.tool_calls[0].name === 'generateCode') {
            code = response.tool_calls[0].args.pythonCode;
            cellCount = cellCount + 1;
            stateUpdates = { ...stateUpdates, code: [...(stateUpdates.code || []), code], cellCount: cellCount, summary: state.summary };
        }
        const { name, args, id } = toolCall;
        // Check if there's a custom handler for this tool
        if (toolHandlers && toolHandlers[name] && id) {
          const handlerUpdates = await toolHandlers[name](args, id, state);
          // Merge handlerUpdates into stateUpdates
          stateUpdates = { ...stateUpdates, ...handlerUpdates };
          const toolMessage = new ToolMessage({
            content: JSON.stringify({ response: handlerUpdates }), 
            tool_call_id: id,
            name: name,
          });
          
          // Push the ToolMessage to the messages array
          messages.push(toolMessage);
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
    // Return the new messages and any state updates
    return { messages: messages, ...stateUpdates };
  }
}