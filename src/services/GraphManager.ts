import { StateGraph, END, StateGraphArgs, START, CompiledStateGraph } from '@langchain/langgraph';
import { Message, TaskState } from '../models/TaskState';
import { Graph } from '../models/Graph';
import { getPlanNode, getAgentNode, getRouteEdge, getSolveNode, getDirectResponseNode, getSubGraphAgentNode } from './WorkflowHandler';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import dotenv from 'dotenv';
import { SupabaseSaver } from '../checkpoint/supabase';
dotenv.config();

const { MEMORY_STORAGE_SUPABASE_URL, MEMORY_STORAGE_SUPABASE_KEY} = process.env;

export class GraphManager {
  planNode: (state: TaskState) => Promise<{ steps: Array<[string, string, string, string]>; plan_string: string }>;
  agents: { [key: string]: { agent: BaseChatModel, agentPrompt: string, toolFunction: Function } };
  agentSubgraphs: { [key: string]: { agentSubGraph: any } };
  solveNode: (state: TaskState) => Promise<{ result: string }>;
  directResponseNode: (state: TaskState) => Promise<{ result: string }>;
  graph: Graph<any, any>;

  constructor(
    planModel: BaseChatModel,
    agents: { [key: string]: { agent: BaseChatModel, agentPrompt: string, toolFunction: Function } },
    agentSubgraphs: { [key: string]: { agentSubGraph: any} },
    solveModel: BaseChatModel,
    outputHandler: Function,
    directResponseModel: BaseChatModel
  ) {
    this.planNode = getPlanNode(planModel, outputHandler);
    this.agents = agents;
    this.agentSubgraphs = agentSubgraphs;
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
        value: (x: [string, string, string, string][], y: [string, string, string, string][]) => y ?? x ?? [],
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
        value: (x?: string | null, y?: string | null) => {
          if (y == null) {
            return null;
          }
          return y ?? x ?? null;
        },
        default: () => null,
      },
      messages: {
        value: (x: Message[], y: Message[]) => y ?? x,
        default: () => [],
      },
    };
      
    const workflow = new StateGraph<TaskState>({
      channels: planExecuteState,
    }).addNode('plan', this.planNode)
    .addNode('solve', this.solveNode)
    .addNode('direct', this.directResponseNode)
    .addEdge(START, 'plan')
    .addConditionalEdges('plan', getRouteEdge())
    .addEdge('solve', END)
    .addEdge('direct', END);

    for (const [name, { agent, agentPrompt, toolFunction}] of Object.entries(this.agents)) {
      const agentNode = getAgentNode(agent, agentPrompt, toolFunction);  
      workflow.addNode(name, agentNode);
      workflow.addConditionalEdges(name as any, getRouteEdge()); // TODO: As any here is due to a langraph bug
    }

    for (const [name, { agentSubGraph }] of Object.entries(this.agentSubgraphs)) {
      const agentNode = getSubGraphAgentNode(agentSubGraph);  
      workflow.addNode(name, agentNode);
      workflow.addConditionalEdges(name as any, getRouteEdge()); // TODO: As any here is due to a langraph bug
    }

    if(!MEMORY_STORAGE_SUPABASE_URL || !MEMORY_STORAGE_SUPABASE_KEY) {
      throw new Error
    }
    
    const memory = new SupabaseSaver(MEMORY_STORAGE_SUPABASE_URL,MEMORY_STORAGE_SUPABASE_KEY);
    // const memory = new MemorySaver();

    return workflow.compile({ checkpointer: memory });
  }

  getApp(): any {
    return this.graph;
  }
}
