import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { systemPrompt, planPrompt, solvePrompt, solveMemoryPrompt } from '../models/Prompts';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Message, TaskState } from '../models/TaskState';
import { ErrorResponse, FunctionDetails, InputData } from '../interfaces/types';
import Logger from '../utils/Logger';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';



export function extractFunctionDetails(input_data: AIMessage): FunctionDetails[] {
  const functionDetails: FunctionDetails[] = [];

  const toolCalls = input_data.additional_kwargs?.tool_calls ?? [];

  // if toolCalls is empty, we trigger an error
  if (toolCalls.length === 0) {
    throw new Error('No tool calls found in the response, this model is not using the tooling feature.');
  }

  for (const call of toolCalls) {
    const functionName = call.function.name;
    const args = JSON.parse(call.function.arguments);

    functionDetails.push({ function_name: functionName, arguments: args });
  }

  return functionDetails;
}

function stringifyMessages(messages: Message[]): string[][] {
  return messages.flatMap(message => message.text);
}

// nodes

export function getPlanNode(plannerModel: BaseChatModel, outputHandler: Function) {
  async function plan(state: TaskState): Promise<TaskState> {
    try {
      const task = state.task;
      const messages = state.messages || [];
      const messagesTyped = stringifyMessages(messages) as any;
      const chatPromptTemplate = ChatPromptTemplate.fromMessages([['system', systemPrompt],...messagesTyped,['human', planPrompt]]);
      const chain = chatPromptTemplate.pipe(plannerModel);

      const plan = await chain.invoke({ task: task }); 

      const agentName = (plan as any).agentName;
      const description = (plan as any).description;
      const directResponse = (plan as any).directResponse;

      outputHandler('plan', description);

      if (directResponse) {
        const historyPromptTemplate = [['human', "Here is a task: "+task],['ai', directResponse]]; 
        const historyMessage: Message = {text: historyPromptTemplate}
        const allHistory = [...state.messages, historyMessage]

        return { 
          ...state,
          directResponse: directResponse,
          messages: allHistory,
         };
      } else{
        const historyPromptTemplate = [['human', "Here is a task: "+task],['ai', description]]; 
        const historyMessage: Message = {text: historyPromptTemplate}
        const allHistory = [...state.messages, historyMessage]
        return { 
          ...state,
          agentName: agentName,
          agentDescription: description,
          messages: allHistory,
         };
      }

    } catch (error) {
      Logger.warn('Error in plan node:', error);
      return {
        ...state,
        directResponse: 'We had a problem creating a response for your requests. Please try again or contact support.',
      }; // TODO: Create a dedicated error node
    }
  }

  return plan;
}

export function getAgentNode(model: BaseChatModel, agentPrompt: string, toolFunction: Function) { // TODO: delete this, we are using subgraphs now
  async function agentNode(state: TaskState): Promise<Partial<TaskState>> {
    try {

      const result = await model.invoke([new SystemMessage(agentPrompt), new HumanMessage(state.agentDescription)]);      
      const functions = extractFunctionDetails(result);
      const results = await toolFunction('tool', functions);
      const lastMessageIndex = state.messages.length - 1;
      const lastMessage = state.messages[lastMessageIndex];
      const updatedAdditionalData = {
        ...lastMessage.additionalData,
        functions, 
      };

      // we gotta clear this
      if (state.directResponse) {
        state.directResponse = null;
      }
      
      const updatedLastMessage = {
        ...lastMessage,
        additionalData: updatedAdditionalData,
      };
      state.messages[lastMessageIndex] = updatedLastMessage;

      Logger.log(
        `Agent executed step ${state.agentName} with input ${state.agentDescription}, results: ${JSON.stringify(results)}`,
      );
      return { result: results };
    } catch (error) {
      Logger.log('error in agent node', error)
      Logger.warn('Error in agent execution:', error);
      return { result: 'Error in agent execution, please try again or contact support.' };
    }
  }
  return agentNode;
}

export function getSubGraphAgentNode(graph: any) { // TODO: update graph to be a StateGraph with subtype state of the subgraph
  async function agentNode(state: TaskState): Promise<Partial<TaskState>> {
    try {
      const result = ((await graph.getGraph().invoke({task:state.agentDescription.toString()})) as any).finalResult;   
      Logger.log(
        `Agent executed step ${state.agentName} with input ${state.agentDescription}, results: ${JSON.stringify(result)}`,
      );


      return { result: result, agentName: ""};
    } catch (error) {
      Logger.warn('Error in agent execution:', error);
      return { result: 'Error in agent execution, please try again or contact support.' };
    }
  }
  return agentNode;
}

export function getDirectResponseNode(outputHandler: Function) {
  async function response(state: TaskState): Promise<Partial<TaskState>> {
    if (state.directResponse) {
      const directResponse = state.directResponse;
      outputHandler('directResponse', directResponse);
      state.directResponse = null; 
      Logger.log('Direct response:', directResponse);
      return { result: directResponse };
    } else {
      Logger.warn('No direct response available in state.');
      return { result: 'No direct response available.' };
    }
  }

  return response;
}

export function getSolveNode(solverModel: BaseChatModel, outputHandler: Function) { 
  async function solve(state: TaskState): Promise<Partial<TaskState>> {

      const finalResult = await solverModel.invoke(['human', 'State the following result to the user:' + state.result]);
      outputHandler('result', finalResult.content);
      Logger.log('Final response:', finalResult.content)
      
      const stateMessage = state.messages
      const historyPromptTemplate: Message = {text:[['human', finalResult.content.toString()],['ai', "It was executed successfully, ready for your next task"]]}; // TODO: clean this up
      const stateHistory = [...stateMessage, historyPromptTemplate]

      return {messages: stateHistory};
  }
  return solve;
}

export function getRouteEdge() {
  function route(state: TaskState): string {
    if (state.agentName && state.agentName !== "") {
      return state.agentName
    } else if (state.directResponse) {
      return 'direct';
    }
    else {
      return 'solve';
    }
  }

  return route;
}