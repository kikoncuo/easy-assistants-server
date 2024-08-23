import { GraphManager } from './GraphManager';
import { getFasterModel, createPlanner } from '../models/Models';
import { dataSystemPrompt, insightsSystemPrompt } from '../models/Prompts';
import dotenv from 'dotenv';
import { DataRecoveryGraph } from '../subgraphs/getData';
import { InsightGraph } from '../subgraphs/getInsights';

dotenv.config();

type SubgraphConfig = {
  name: 'dataAgent' | 'getInsights';
  Graph: new (databaseId: number, clientAgentFunctions: Function[]) => any;
  systemPrompt: string;
};

type AppConfig = {
  [key: string]: SubgraphConfig[];
};

export class GraphApplication {
  private graphManager!: GraphManager; //  (!) tells TypeScript that it will be definitely assigned before it's used.
  error: any;

  private static readonly APP_CONFIGS: AppConfig = {
    default: [{ name: 'dataAgent', Graph: DataRecoveryGraph, systemPrompt: dataSystemPrompt }],
    insights: [{ name: 'getInsights', Graph: InsightGraph, systemPrompt: insightsSystemPrompt }],
    // Add more app types here as needed
  };

  constructor(
    private readonly outputHandler: Function,
    private readonly clientAgentFunction: Function,
    private readonly clientData: string[],
    private readonly appType: string
  ) {
    this.validateClientData();
    this.initializeGraphManager();
  }

  private validateClientData(): void {
    if (this.clientData.length < 1) {
      throw new Error(
        "When creating your GraphApplication you must provide at least 1 field for clientData, [0] must be the Cube's company name"
      );
    }
  }

  private initializeGraphManager(): void {
    const fasterModel = getFasterModel();
    const planner = createPlanner(fasterModel);
    const { subgraphs, systemPrompt } = this.createSubgraphsAndSystemPrompt();

    this.graphManager = new GraphManager(
      planner,
      systemPrompt,
      subgraphs,
      fasterModel,
      this.outputHandler
    );
  }

  private createSubgraphsAndSystemPrompt(): { subgraphs: any; systemPrompt: string } {
    const configs = GraphApplication.APP_CONFIGS[this.appType];
    const subgraphs: { [key: string]: any } = {};
    let systemPrompt = '';

    configs.forEach((config) => {
      subgraphs[config.name] = {
        agentSubGraph: new config.Graph(
          +this.clientData[0],
          [this.clientAgentFunction]
        ),
      };
      systemPrompt = config.systemPrompt;
    });

    return { subgraphs, systemPrompt };
  }

  async processTask(task: string, thread_id: string, ws: WebSocket): Promise<void> {
    const config = { 
      configurable: { thread_id },
      streamMode: 'values',
      recursion_limit: 2,
    };

    await this.graphManager.getApp().invoke({ task }, config);
  }
}