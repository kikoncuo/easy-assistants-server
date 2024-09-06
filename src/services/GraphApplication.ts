import { GraphManager } from './GraphManager';
import { getFasterModel, createPlanner } from '../models/Models';
import { dataSystemPrompt, insightsSystemPrompt } from '../models/Prompts';
import { DataRecoveryGraph } from '../subgraphs/getData';
// import { InsightGraph } from '../subgraphs/getInsights';
// import { InsightExtractorGraph } from '../subgraphs/insightExtractor';
import { InsightExtractorGraph } from '../subgraphs/newInsightExtractor';
import { CreateDashboardGraph } from '../subgraphs/createDashboard';

type SubgraphConfig = {
  name: string;
  Graph: new (databaseId: number, clientAgentFunctions: Function[], companyName: string) => any;
};

type AppConfig = {
  [key: string]: {
    subgraphs: SubgraphConfig[];
    systemPrompt: string;
  };
};

export class GraphApplication {
  private graphManager!: GraphManager;
  error: any;

  private static readonly APP_CONFIGS: AppConfig = {
    default: {
      subgraphs: [
        { name: 'dataAgent', Graph: DataRecoveryGraph },
        { name: 'createDashboard', Graph: CreateDashboardGraph }
      ],
      systemPrompt: dataSystemPrompt
    },
    insights: {
      subgraphs: [{ name: 'getInsights', Graph: InsightExtractorGraph }],
      systemPrompt: insightsSystemPrompt
    },
    // Add more app types here as needed
  };

  constructor(
    private readonly outputHandler: Function,
    private readonly clientAgentFunction: Function,
    private readonly clientData: string[],
    private readonly appType: string,
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
      this.clientData[1],
      planner,
      systemPrompt,
      subgraphs,
      fasterModel,
      this.outputHandler
    );
  }

  private createSubgraphsAndSystemPrompt(): { subgraphs: any; systemPrompt: string } {
    const config = GraphApplication.APP_CONFIGS[this.appType];
    const subgraphs: { [key: string]: any } = {};

    config.subgraphs.forEach((subgraphConfig) => {
      subgraphs[subgraphConfig.name] = {
        agentSubGraph: new subgraphConfig.Graph(
          +this.clientData[0],
          [this.clientAgentFunction],
          this.clientData[1]
        ),
      };
    });

    return { subgraphs, systemPrompt: config.systemPrompt };
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