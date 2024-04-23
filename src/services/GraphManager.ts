import { StateGraph, END } from '@langchain/langgraph';
import { TaskState } from '../models/TaskState';
import { Graph } from '../models/Graph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getPlanNode, getAgentNode, getRouteEdge, getSolveNode } from './WorkflowHandler';
import { Runnable } from 'langchain/runnables';
export class GraphManager {
  planNode: (state: TaskState) => Promise<{ steps: Array<[string, string, string, string]>; plan_string: string }>;
  agentFunction: Function;
  agents: { [key: string]: { agent: Runnable; agentPrompt: string } };
  solveNode: (state: TaskState) => Promise<{ result: string }>;
  graph: Graph<any, any>;

  constructor(
    planModel: Runnable,
    agents: { [key: string]: { agent: Runnable; agentPrompt: string } },
    solveModel: BaseChatModel,
    outputHandler: Function,
    agentFunction: Function,
  ) {
    this.planNode = getPlanNode(planModel, outputHandler);
    this.agentFunction = agentFunction;
    this.agents = agents;
    this.solveNode = getSolveNode(solveModel, outputHandler);
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
      },
    });

    graph.addNode('plan', this.planNode);
    graph.addNode('solve', this.solveNode);
    graph.addConditionalEdges('plan', getRouteEdge());
    graph.addEdge('solve', END);

    for (const [name, { agent, agentPrompt }] of Object.entries(this.agents)) {
      const agentNodePartial = getAgentNode(agent, this.agentFunction, agentPrompt);
      graph.addNode(name, (state: TaskState) => agentNodePartial(state, agent, this.agentFunction, agentPrompt));
      graph.addConditionalEdges(name, getRouteEdge());
    }

    graph.setEntryPoint('plan');
    return graph.compile();
  }

  getApp(): any {
    return this.graph;
  }
}
