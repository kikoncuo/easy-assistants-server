// LangraphReWoo.ts
import { StateGraph, END } from '@langchain/langgraph';
import { HumanMessage, AIMessage, SystemMessage } from 'langchain/schema';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { planPrompt, solvePrompt } from '../models/Prompts';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from 'langchain/runnables'; // TODO: Models with tools are runnables because fuck me, we need to fix this
import { TaskState } from '../models/TaskState';
import { FunctionDetails, InputData } from '../interfaces/types';
import Logger from '../utils/Logger';

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

function processSteps(inputData: InputData | AIMessage): { stepsArray: string[][]; fullPlan: string } {
  let steps: any[];
  // Sometimes models return an AIMessage, instead of returning the structured data directly
  if (inputData instanceof AIMessage) {
    try {
      steps = JSON.parse(inputData.content.toString()).steps;
    } catch (error) {
      Logger.warn('Warning: Failed to parse the AIMessage content as JSON.', error);
      return { stepsArray: [], fullPlan: '' };
    }
  } else {
    steps = inputData.steps;
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

  return { stepsArray, fullPlan };
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

// nodes

export function getPlanNode(plannerModel: Runnable, outputHandler: Function) {
  async function plan(state: TaskState): Promise<{ steps: any; plan_string: string }> {
    try {
      const task = state.task;
      let allChunks = '';
      let tempChunk = '';
      let instructionNumber = 0;

      const chatPromptTemplate = ChatPromptTemplate.fromMessages([['human', planPrompt]]);

      const chain = chatPromptTemplate.pipe(plannerModel);

      /*const stream = await chain.stream({ task: task }); // TODO: This parsing on the stream is not working, we should disable streaming for now, and use structured output with dynamic json parsing later
      for await (const output of stream.values()) {
          const chunk = output.content.toString();
          allChunks += chunk;
          if (chunk.endsWith('.')) {
            instructionNumber += 1;
            tempChunk += chunk;
            Logger.log('tempChunk: ', tempChunk)
            try {
              const desiredText = tempChunk.split('Plan:')[1].split('.')[0] + '.';
              Logger.log('desiredText: ', desiredText)
              outputHandler('plan step', `#E${instructionNumber}: ${desiredText.trim()}`);
            } catch (error) {
                Logger.warn('Warning: Failed to extract the text in chunks, the model may not be using streaming.', error);
            }
            tempChunk = '';
          }
          tempChunk += chunk;
      }*/

      const plan = await chain.invoke({ task: task });

      const { stepsArray, fullPlan } = processSteps(plan);

      outputHandler('plan', fullPlan);

      Logger.log('Plan steps: ', stepsArray);
      return { steps: stepsArray, plan_string: fullPlan };
    } catch (error) {
      Logger.warn('Error in plan node:', error);
      return {
        steps: [['Error running query', '#E1', 'solve', 'we had a problem creating the plan']],
        plan_string: 'We had a problem creating a plan for your requests. Please try again or contact support.',
      }; // TODO: Create a dedicated error node
    }
  }

  return plan;
}

export function getAgentNode(agent: Runnable, agentFunction: Function, agentPrompt: string) {
  async function agentNode(state: TaskState, agent: Runnable, agentFunction: Function, agentPrompt: string) {
    try {
      const _step = _getCurrentTask(state);
      if (_step === null) throw new Error('No more steps to execute.');
      let [, stepName, tool, toolInput] = state.steps[_step - 1];
      const _results = state.results || {};
      for (const [k, v] of Object.entries(_results)) {
        toolInput = toolInput.replace(k, v);
      }
      const result = await agent.invoke([new SystemMessage(agentPrompt), new HumanMessage(toolInput)]);
      const functions = extractFunctionDetails(result);
      const results = await agentFunction('tool', functions);
      _results[stepName] = JSON.stringify(results);
      Logger.log(
        `Agent executed step ${stepName} with tool ${tool} and input ${toolInput}, results: ${JSON.stringify(results)}`,
      );
      return { results: _results };
    } catch (error) {
      Logger.warn('Error in agent execution:', error);
      return { results: 'Error in agent execution, please try again or contact support.' };
    }
  }
  return agentNode;
}

export function getSolveNode(solverModel: BaseChatModel, outputHandler: Function) {
  async function solve(state: TaskState): Promise<{ result: string }> {
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

      const prompt = solvePrompt.replace('{plan}', plan).replace('{task}', state.task);
      const stream = await solverModel.stream([new HumanMessage(prompt)]); // TODO: send the chunks one by one
      let allChunks = '';

      for await (const output of stream) {
        for (const chunk of output.content) {
          allChunks += chunk;
        }
      }

      outputHandler('result', allChunks);
      return { result: allChunks };
    } catch (error) {
      Logger.warn('Error in agent execution:', error);
      
      outputHandler('result', 'Error producing the final answer, please try again or contact support.');
      return { result: 'Error producing the final answer, please try again or contact support.' };
    }
  }

  return solve;
}

export function getRouteEdge() {
  function route(state: TaskState): string {
    try {
      const _step = _getCurrentTask(state);
      if (_step === null) {
        return 'solve';
      }
      const index = state.results ? Object.keys(state.results).length : 0;
      const step = state.steps[index][2];
      return step;
    } catch (error) {
      Logger.error('Error in routing your request, we redirected directly to solve:', error);
      return 'solve'; // TODO: add a default error node
    }
  }

  return route;
}
