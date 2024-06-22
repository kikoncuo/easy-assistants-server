// LangraphReWoo.ts
import { HumanMessage, AIMessage, SystemMessage, MessageContent, MessageType } from 'langchain/schema';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { systemPrompt, planPrompt, solvePrompt, solveMemoryPrompt } from '../models/Prompts';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from 'langchain/runnables'; // TODO: Models with tools are runnables because fuck me, we need to fix this
import { Message, TaskState } from '../models/TaskState';
import { ErrorResponse, FunctionDetails, InputData } from '../interfaces/types';
import Logger from '../utils/Logger';
import { StringWithAutocomplete } from '@langchain/core/utils/types';

// internal function
function _getCurrentTask(state: TaskState): number | null {
  if (state.results === null) {
    return 1;
  }

  if (state.results && Object.keys(state.results).length === state.steps.length) {
    return null;
  } else {
    return Object.keys(state.results || {}).length + 1;
  }
}

function processSteps(inputData: InputData | AIMessage): { stepsArray: string[][]; fullPlan: string, directResponse: string } {
  let steps: any[];
  let directResponse: string;
  // Sometimes models return an AIMessage, instead of returning the structured data directly
  if (inputData instanceof AIMessage) {
    try {
      steps = JSON.parse(inputData.content.toString()).steps;
      directResponse = JSON.parse(inputData.content.toString()).directResponse;
    } catch (error) {
      Logger.warn('Warning: Failed to parse the AIMessage content as JSON while creating the plan. (Using a different planner may help).', error);
      Logger.warn('This was the AIMessage:', inputData.content.toString());
      Logger.warn('Error:', error);
      return { stepsArray: [], fullPlan: '', directResponse: '' };
    }
  } else {
    steps = inputData.steps;
    directResponse = inputData.directResponse;
  }

  if (!steps) {
    return { stepsArray: [], fullPlan: "", directResponse };
  }

  // Anthropic tends to return the steps as a string, so we need to parse it
  if (typeof steps[0] === 'string') {
    try {
      steps = JSON.parse(steps[0]);
    } catch (error) {
      Logger.warn('Warning: Failed to parse the input data as JSON, using it as a string.', error);
    }
  }

  const stepsArray: string[][] = steps.map(step => [
    step.description,
    step.stepId,
    step.toolName,
    step.toolParameters.join(', '),
  ]);

  const fullPlan: string = steps.map(step => `${step.stepId} ${step.description}`).join('\n');

  return { stepsArray, fullPlan, directResponse };
}

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

// function that deletes curly brackets from a string
function removeCurlyBrackets(str: string): string {
  return str.replace(/{/g, '').replace(/}/g, '');
}

// function that duplicates curly brackets from a string
function duplicateCurlyBrackets(str: string): string {
  return str.replace(/{/g, '{{').replace(/}/g, '}}');
}

function stringifyMessages(messages: Message[]): string[][] {
  return messages.flatMap(message => message.text);
}

// nodes

export function getPlanNode(plannerModel: BaseChatModel, outputHandler: Function) {
  async function plan(state: TaskState): Promise<{ steps: any; plan_string: string, directResponse: string, messages: Message[], results: any }> {
    try {
      const task = state.task;
      const results = state.results || {};
      const messages = state.messages || [];
      const messagesTyped = stringifyMessages(messages) as any;
      const chatPromptTemplate = ChatPromptTemplate.fromMessages([['system', systemPrompt],...messagesTyped,['human', planPrompt]]);
      console.log('messages', [['system', systemPrompt],...messagesTyped,['human', planPrompt]])
      const chain = chatPromptTemplate.pipe(plannerModel);
      //console.log('from get plan node', state)

      const plan = await chain.invoke({ task: task }); 

      const { stepsArray, fullPlan, directResponse } = processSteps(plan);

      const planString = duplicateCurlyBrackets(JSON.stringify(plan));
      // TODO: use actual chain output instead of emulating messages
      const historyPromptTemplate = [['human', "Here is a task: "+task],['ai', planString]]; // TODO: This may cause errors if other models than gpt are used for plannerModel, also use prompt format https://js.langchain.com/v0.2/docs/how_to/prompts_partial 
      const historyMessage: Message = {text: historyPromptTemplate}
      const allHistory = [...state.messages, historyMessage]

      outputHandler('plan', fullPlan);

      Logger.log('Plan steps: ', stepsArray);

      return { steps: stepsArray, plan_string: fullPlan, directResponse, messages: allHistory, results: {}  };
    } catch (error) {
      Logger.warn('Error in plan node:', error);
      return {
        steps: [['Error running query', '#E1', 'solve', 'we had a problem creating the plan']],
        plan_string: 'We had a problem creating a plan for your requests. Please try again or contact support.',
        directResponse: 'We had a problem creating a response for your requests. Please try again or contact support.',
        messages: [],
        results: {},
      }; // TODO: Create a dedicated error node
    }
  }

  return plan;
}

export function getAgentNode(model: BaseChatModel, agentPrompt: string, toolFunction: Function) {
  async function agentNode(state: TaskState): Promise<Partial<TaskState>> {
    try {
      console.log('state at agent node', state)
      const _step = _getCurrentTask(state);
      if (_step === null) throw new Error('No more steps to execute.');
      let [, stepName, tool, toolInput] = state.steps[_step - 1];
      const _results = state.results || {};
      for (const [k, v] of Object.entries(_results)) {
        toolInput = toolInput.replace(k, v);
      }
      const result = await model.invoke([new SystemMessage(agentPrompt), new HumanMessage(toolInput)]);      
      const functions = extractFunctionDetails(result);
      const results = await toolFunction('tool', functions);
      const lastMessageIndex = state.messages.length - 1;
      const lastMessage = state.messages[lastMessageIndex];
      const updatedAdditionalData = {
        ...lastMessage.additionalData,
        functions, 
      };
      
      const updatedLastMessage = {
        ...lastMessage,
        additionalData: updatedAdditionalData,
      };
      
      state.messages[lastMessageIndex] = updatedLastMessage;

      _results[stepName] = Object.values(results)[0] as string;
      Logger.log(
        `Agent executed step ${stepName} with tool ${tool} and input ${toolInput}, results: ${JSON.stringify(results)}`,
      );
      return { results: _results };
    } catch (error) {
      console.log('error in agent node', error)
      Logger.warn('Error in agent execution:', error);
      return { results: { error: 'Error in agent execution, please try again or contact support.' } };
    }
  }
  return agentNode;
}

export function getDirectResponseNode(directResponseModel: BaseChatModel, outputHandler: Function) {
  async function response(state: TaskState): Promise<{ result: string }> {
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
  async function solve(state: TaskState): Promise<{ result: string, messages: Message[]  }> {
    try {
      let plan = '';
      for (let [_plan, stepName, tool, toolInput] of state.steps) {
        const _results = state.results || {};
        for (const [k, v] of Object.entries(_results)) {
          toolInput = toolInput.replace(k, v);
          stepName = stepName.replace(k, v);
        }
        plan += `Plan: ${_plan}\n${stepName} = ${tool}[${toolInput}]`;
      }
      //console.log('from get solve node', state)
      const stateMessage = state.messages
      // stateMessage[state.messages.length - 1].additionalData = state.results


      const chatPromptTemplate = ChatPromptTemplate.fromMessages([['human', solvePrompt]]);

      const chain = chatPromptTemplate.pipe(solverModel);

      const responseResult = await chain.invoke({task: state.task, plan: plan, results: state.results});

      let finalResponse = "";

      if (responseResult.content) { 
        finalResponse = responseResult.content as string;
      } else {
        finalResponse = JSON.stringify(responseResult);
      }

      outputHandler('result', finalResponse);
      Logger.log('Final response:', finalResponse)

      const historyPromptTemplate: Message = {text:[['human', solveMemoryPrompt+removeCurlyBrackets(JSON.stringify(state.results))],['ai', "It was executed successfully, ready for your next task"]]}; // TODO: clean this up
      const stateHistory = [...stateMessage, historyPromptTemplate]

      console.log('stateHistory', stateHistory) 

      return { result: finalResponse, messages: stateHistory};
    } catch (error) {
      Logger.warn('Error in agent execution:', error);
      
      outputHandler('result', 'Error producing the final answer, please try again or contact support.');
      return { result: 'Error producing the final answer, please try again or contact support.', messages: []};
    }
  }

  return solve;
}

export function getRouteEdge() {
  function route(state: TaskState): string {
    try {
      if (state.directResponse || state.steps.length === 0) {
        return 'direct';
      }
      const _step = _getCurrentTask(state);
      if (_step === null) {
        return 'solve';
      }
      const index = state.results ? Object.keys(state.results).length : 0;
      const step = state.steps[index][2];
      return step;
    } catch (error) {
      Logger.error('Error in routing your request, we redirected directly to solve:', error);
      return 'solve'; 
    }
  }

  return route;
}