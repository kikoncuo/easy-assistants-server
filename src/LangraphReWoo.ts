// LangraphReWoo.ts
import { StateGraph, END } from '@langchain/langgraph';
import { HumanMessage, AIMessage, SystemMessage } from 'langchain/schema';
import { BaseChatModel} from "@langchain/core/language_models/chat_models";
import { planPrompt, solvePrompt } from './prompts';
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Runnable } from 'langchain/runnables'; // Models with tools are runnables because fuck me



class Graph<T = any, U = any> { // TODO: Use the correct type from langchain
    channels?: U;
  }

// This class contains the shared state across all nodes
class ReWOO {
 task: string;
 plan_string: string;
 steps: Array<[string, string, string, string]>;
 results: { [key: string]: string } | null;
 result: string;

 constructor(task: string, plan_string: string, steps: Array<[string, string, string, string]>, results: { [key: string]: string } | null, result: string) {
   this.task = task;
   this.plan_string = plan_string;
   this.steps = steps;
   this.results = results;
   this.result = result;
 }
}

interface FunctionDetails {
    function_name: string;
    arguments: any;
}

// internal function
function _getCurrentTask(state: ReWOO): number | null {
 if (state.results === null) {
   return 1;
 }
 if (state.results && Object.keys(state.results).length === state.steps.length) {
   return null;
 } else {
   return Object.keys(state.results || {}).length + 1;
 }
}

export function extractFunctionDetails(input_data: AIMessage): FunctionDetails[] {
    const functionDetails: FunctionDetails[] = [];
  
    const toolCalls = input_data.additional_kwargs?.tool_calls ?? [];
  
    for (const call of toolCalls) {
      const functionName = call.function.name;
      const args = JSON.parse(call.function.arguments);
  
      functionDetails.push({ function_name: functionName, arguments:args });
    }
  
    return functionDetails;
  }

// nodes

function getPlanNode(plannerModel: BaseChatModel, outputHandler: (type: string, message: string) => void) {
    async function plan(state: ReWOO): Promise<{ steps: any, plan_string: string }> {
      const task = state.task;
      let allChunks = '';
      let tempChunk = '';
      let instructionNumber = 0;

      const chatPromptTemplate = ChatPromptTemplate.fromMessages([
        ["human", planPrompt],
      ]);

      const chain = chatPromptTemplate.pipe(plannerModel);
      
      const stream = await chain.stream({ task: task });
      for await (const output of stream.values()) {
          const chunk = output.content.toString();
          allChunks += chunk;
          if (chunk.endsWith('.')) {
            instructionNumber += 1;
            tempChunk += chunk;
            try {
              const desiredText = tempChunk.split('Plan:')[1].split('.')[0] + '.';
              outputHandler('plan step', `#E${instructionNumber}: ${desiredText.trim()}`);
            } catch (error) {
                console.warn('Warning: Failed to extract desired text.', error);
            }
            tempChunk = '';
          }
          tempChunk += chunk;
      }
  
      const regex = /Plan:\s*(.+)\s*(#E\d+)\s*=\s*(\w+)\s*\[([^\]]+)\]/g;
      const matches = [...allChunks.matchAll(regex)];
      // Ensure we're correctly extracting the four required pieces of information for each step
      const steps = matches.map(match => {
        // Destructure the match to extract the needed parts. Note that `match[0]` is the entire matched string, which we don't need here.
        const [, plan, stepName, tool, toolInput] = match;
        return [plan, stepName, tool, toolInput];
      });      
      return { steps:steps, plan_string: allChunks };
    }
  
    return plan;
  }

function getToolExecutionNode(toolsMap: { [key: string]: { invoke: (input: string) => Promise<any> } }) {
 async function toolExecution(state: ReWOO): Promise<{ results: { [key: string]: string } }> {
   const _step = _getCurrentTask(state);
   if (_step === null) throw new Error('No more steps to execute.');
   let [, stepName, tool, toolInput] = state.steps[_step - 1];
   console.log(`Executing step ${stepName} with tool ${tool} and input ${toolInput}`);

   const _results = state.results || {};
   for (const [k, v] of Object.entries(_results)) {
     toolInput = toolInput.replace(k, v);
   }

   if (tool in toolsMap) {
     const result = await toolsMap[tool].invoke(toolInput);
     _results[stepName] = result.toString();
   } else {
     throw new Error(`Tool ${tool} is not recognized.`);
   }

   return { results: _results };
 }

 return toolExecution;
}


function getAgentNode(agent: Runnable, agentFunction: Function, agentPrompt: string) {
  async function agentNode(state: ReWOO, agent: Runnable, agentFunction: Function, agentPrompt: string) {
      const _step = _getCurrentTask(state);
      if (_step === null) throw new Error('No more steps to execute.');
      let [, stepName, tool, toolInput] = state.steps[_step - 1];
      const _results = state.results || {};
      for (const [k, v] of Object.entries(_results)) {
          toolInput = toolInput.replace(k, v);
      }
      console.log("Step name: ", stepName);
      console.log(state.steps[_step - 1]);
      console.log('Invoking agent with toolInput');
      console.log(toolInput);
      const result = await agent.invoke([
          new SystemMessage(agentPrompt),
          new HumanMessage(toolInput)
      ]);
      const functions = extractFunctionDetails(result);
      console.log('Agent extracted functions:\n');
      console.log(functions);
      const results = await agentFunction('tool', functions);
      _results[stepName] = results.toString();
      console.log(`Agent executed step ${stepName} with tool ${tool} and input ${toolInput}`);
      return { results: _results };
  }
  return agentNode;
}

function getSolveNode(solverModel: BaseChatModel) {
    async function solve(state: ReWOO): Promise<{ result: string }> {
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
      const stream = await solverModel.stream([new HumanMessage(prompt)]);
      let allChunks = '';
  
      for await (const output of stream) {
        for (const chunk of output.content) {
          allChunks += chunk;
        }
      }
  
      return { result: allChunks };
    }
  
    return solve;
  }

function getRouteEdge() {
 function route(state: ReWOO): string {
   const _step = _getCurrentTask(state);
   if (_step === null) {
     return 'solve';
   }
   const index = state.results ? Object.keys(state.results).length : 0;
   const step = state.steps[index][2];
   return step;
 }

 return route;
}

// graph definition
class GraphManager {
  planNode: (state: ReWOO) => Promise<{ steps: Array<[string, string, string, string]>; plan_string: string }>;
  agentFunction: Function;
  agents: { [key: string]: { agent: Runnable; agentPrompt: string } };
  solveNode: (state: ReWOO) => Promise<{ result: string }>;
  graph: Graph<any, any>;

  constructor(
    planModel: BaseChatModel,
    agents: { [key: string]: { agent: Runnable; agentPrompt: string } },
    solveModel: BaseChatModel,
    outputHandler: (type: string, message: string) => void,
    agentFunction: Function
  ) {
    this.planNode = getPlanNode(planModel, outputHandler);
    this.agentFunction = agentFunction;
    this.agents = agents;
    this.solveNode = getSolveNode(solveModel);
    this.graph = this._constructGraph();
  }

  _constructGraph(): Graph<any, any> {
    const graph = new StateGraph<ReWOO>({
      channels: {
        task: { value: null },
        plan_string: { value: null },
        steps: { value: (x, y) => x.concat(y), default: () => [] },
        results: { value: null },
        result: { value: null },
      },
    });

    graph.addNode('plan', this.planNode);
    graph.addNode('solve', this.solveNode);
    graph.addConditionalEdges('plan', getRouteEdge());
    graph.addEdge('solve', END);

    for (const [name, { agent, agentPrompt }] of Object.entries(this.agents)) {
      const agentNodePartial = getAgentNode(agent, this.agentFunction, agentPrompt);
      graph.addNode(name, (state: ReWOO) => agentNodePartial(state, agent, this.agentFunction, agentPrompt));
      graph.addConditionalEdges(name, getRouteEdge());
    }

    graph.setEntryPoint('plan');
    return graph.compile();
  }

  getApp(): any {
    return this.graph;
  }
}

export { GraphManager, ReWOO };