import { StateGraph, END } from '@langchain/langgraph';
import { TaskState } from '../models/TaskState';
import { Graph } from '../models/Graph';
import { getPlanNode, getAgentNode, getRouteEdge, getSolveNode, getDirectResponseNode } from './WorkflowHandler';
import { Runnable } from 'langchain/runnables';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { MemorySaver } from "@langchain/langgraph";


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
    const graph = new StateGraph<TaskState>({
      channels: {
        task: { value: null },
        plan_string: { value: null },
        steps: { value: (x, y) => x.concat(y), default: () => [] },
        results: { value: null },
        result: { value: null },
        directResponse: { value: null },
        messages: {
          value: (x: ChatPromptTemplate[], y: ChatPromptTemplate[]) => x.concat(y),
          default: () => [],
        },
      },
    });

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

    const memory = new MemorySaver();

    graph.setEntryPoint('plan');
    return graph.compile(memory);
  }

  getApp(): any {
    return this.graph;
  }
}
