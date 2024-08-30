import { StateGraph, END, StateGraphArgs, START, CompiledStateGraph, MemorySaver } from '@langchain/langgraph';
import { Message, TaskState } from '../models/TaskState';
import { Graph } from '../models/Graph';
import { getPlanNode, getAgentNode, getRouteEdge, getSolveNode, getDirectResponseNode, getSubGraphAgentNode } from './WorkflowHandler';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { PostgresSaver } from '../checkpoint/postgres';
import { ConfigurationManager } from '../utils/ConfigurationManager';

export class GraphManager {
  planNode: (state: TaskState) => Promise<TaskState>;
  agentSubgraphs: { [key: string]: { agentSubGraph: any } };
  solveNode: (state: TaskState) => Promise<Partial<TaskState>>;
  directResponseNode: (state: TaskState) => Promise<Partial<TaskState>>;
  graph: Graph<any, any>;

  constructor(
    companyName: string,
    planModel: BaseChatModel,
    systemPrompt: string,
    agentSubgraphs: { [key: string]: { agentSubGraph: any } },
    solveModel: BaseChatModel,
    outputHandler: Function,
  ) {
    const clientConfig = ConfigurationManager.getConfig(companyName);

    this.planNode = getPlanNode(planModel, outputHandler, systemPrompt);
    this.agentSubgraphs = agentSubgraphs;
    this.solveNode = getSolveNode(solveModel, outputHandler);
    this.directResponseNode = getDirectResponseNode(outputHandler);
    this.graph = this._constructGraph(clientConfig);
  }

  _constructGraph(clientConfig: any): Graph<any, any> {
    const planExecuteState: StateGraphArgs<TaskState>["channels"] = {
      task: {
        value: (left?: string, right?: string) => right ?? left ?? "",
      },
      agentName: {
        value: (x?: string, y?: string) => y ?? x ?? "",
        default: () => "",
      },
      agentDescription: {
        value: (x?: string, y?: string) => y ?? x ?? "",
        default: () => "",
      },
      cardId: {
        value: (x?: number, y?: number) => y ?? x ?? 0,
        default: () => 0,
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

    for (const [name, { agentSubGraph }] of Object.entries(this.agentSubgraphs)) {
      const agentNode = getSubGraphAgentNode(agentSubGraph);  
      workflow.addNode(name, agentNode);
      workflow.addConditionalEdges(name as any, getRouteEdge()); // TODO: As any here is debido a un bug de langraph
    }

    const poolConfig = {
      host: clientConfig.PG_HOST,
      port: Number(clientConfig.PG_PORT),
      user: clientConfig.PG_USER,
      password: clientConfig.PG_PASSWORD,
      database: clientConfig.PG_DATABASE,
    };
    
    const postgresSaver = new PostgresSaver(poolConfig);

    return workflow.compile({ checkpointer: postgresSaver });
  }

  getApp(): any {
    return this.graph;
  }
}
