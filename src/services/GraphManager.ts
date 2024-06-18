import { StateGraph, END, StateGraphArgs } from '@langchain/langgraph';
import { TaskState } from '../models/TaskState';
import { Graph } from '../models/Graph';
import { getPlanNode, getAgentNode, getRouteEdge, getSolveNode, getDirectResponseNode } from './WorkflowHandler';
import { Runnable } from 'langchain/runnables';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from "@langchain/core/prompts";
// import { MemorySaver } from "@langchain/langgraph";
import { MemorySaver } from '../checkpoint/memory';
// import { SupabaseSaverAssertImmutable } from '../checkpoint/supabaseSaver';
import dotenv from 'dotenv';
import { SupabaseSaver } from '../checkpoint/supabase';
dotenv.config();

const { SUPABASE_URL, SUPABASE_KEY} = process.env;

export class GraphManager {
  planNode: (state: TaskState) => Promise<{ steps: Array<[string, string, string, string]>; plan_string: string }>;
  agents: { [key: string]: { agent: BaseChatModel, agentPrompt: string, toolFunction: Function } };
  solveNode: (state: TaskState) => Promise<{ result: string }>;
  directResponseNode: (state: TaskState) => Promise<{ result: string }>;
  graph: Graph<any, any>;

  constructor(
    planModel: BaseChatModel,
    agents: { [key: string]: { agent: BaseChatModel, agentPrompt: string, toolFunction: Function } },
    solveModel: BaseChatModel,
    outputHandler: Function,
    directResponseModel: BaseChatModel
  ) {
    this.planNode = getPlanNode(planModel, outputHandler);
    this.agents = agents;
    this.solveNode = getSolveNode(solveModel, outputHandler);
    this.directResponseNode = getDirectResponseNode(directResponseModel, outputHandler);
    this.graph = this._constructGraph();
  }

  _constructGraph(): Graph<any, any> {
    const planExecuteState: StateGraphArgs<TaskState>["channels"] = {
      task: {
        value: (left?: string, right?: string) => right ?? left ?? "",
      },
      plan_string: {
        value: (x?: string, y?: string) => y ?? x ?? "",
        default: () => "",
      },
      steps: {
        value: (x: [string, string, string, string][], y: [string, string, string, string][]) => x.concat(y),
        default: () => [],
      },
      results: {
        value: (x?: { [key: string]: string } | null, y?: { [key: string]: string } | null) => y ?? x ?? null,
        default: () => null,
      },
      result: {
        value: (x?: string, y?: string) => y ?? x ?? "",
        default: () => "",
      },
      directResponse: {
        value: (x?: string | null, y?: string | null) => y ?? x ?? null,
        default: () => null,
      },
      messages: {
        value: (x: string[][], y: string[][]) => x.concat(y),
        default: () => [],
      },
    };
        // task: { value: '' },
        // plan_string: { value: null },
        // steps: { value: (x, y) => x.concat(y), default: () => [] },
        // results: { value: null },
        // result: { value: null },
        // directResponse: { value: null },
        // messages: {
        //   value: (x: string[][], y: string[][]) => x.concat(y),
        //   default: () => [],
        // },

    graph.addNode('plan', this.planNode);
    graph.addNode('solve', this.solveNode);
    graph.addNode('direct', this.directResponseNode);
    graph.addConditionalEdges('plan', getRouteEdge());
    graph.addEdge('solve', END);
    graph.addEdge('direct', END);

    for (const [name, { agent, agentPrompt, toolFunction}] of Object.entries(this.agents)) {
      const agentNode = getAgentNode(agent, agentPrompt, toolFunction);  
      graph.addNode(name, agentNode);
      graph.addConditionalEdges(name, getRouteEdge());
    }

    // const memory = new MemorySaver();
    if(!SUPABASE_KEY || !SUPABASE_URL) {
      throw new Error
    }
    // const memory = new SupabaseSaver(SUPABASE_URL,SUPABASE_KEY);
    // const memory = new SupabaseMemory(SUPABASE_URL,SUPABASE_KEY);
    const memory = new MemorySaver();

    graph.setEntryPoint('plan');
    return graph.compile(memory);
  }

  getApp(): any {
    return this.graph;
  }
}
