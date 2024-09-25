import { GraphManager } from './GraphManager';
import { getFasterModel, createPlanner } from '../models/Models';
import { dataSystemPrompt, insightsSystemPrompt } from '../models/Prompts';
import { DataRecoveryGraph } from '../subgraphs/getData';
import { InsightExtractorGraph } from '../subgraphs/insightExtractor';
import { InsightDatasetGraph } from '../subgraphs/insightDataset';
import { CreateDashboardGraph } from '../subgraphs/createDashboard';

type SubgraphConfig = {
  name: string;
  Graph: new (databaseId: number, clientAgentFunctions: Function[], companyName: string, schema: any[]) => any;
};

type AppConfig = {
  [key: string]: {
    subgraphs: SubgraphConfig[];
    systemPrompt: string;
  };
};

export class GraphApplication {
  private graphManager!: GraphManager | any; // TODO: Create a type common to all subgraphs
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
      subgraphs: [{ name: 'getInsights', Graph: InsightDatasetGraph }],
      systemPrompt: insightsSystemPrompt
    },
    // Add more app types here as needed
  };

  constructor(
    private readonly outputHandler: Function,
    private readonly clientAgentFunction: Function,
    private readonly clientData: string[],
    private readonly appType: string,
    private readonly schema: any[]
  ) {
    this.validateClientData();
  }

  private validateClientData(): void {
    if (this.clientData.length < 1) {
      throw new Error(
        "When creating your GraphApplication you must provide at least 1 field for clientData, [0] must be the Cube's company name"
      );
    }
  }

  private async initializeGraphManager( schema: any[], appType?: string): Promise<void> {

    if (appType === 'insights') {
      const insightDatasetGraph = new InsightDatasetGraph(+this.clientData[0], [this.clientAgentFunction], this.clientData[1], schema);
      await insightDatasetGraph.initialize();
      this.graphManager = insightDatasetGraph;
    } else {
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
  }

  private createSubgraphsAndSystemPrompt(): { subgraphs: any; systemPrompt: string } {
    const config = GraphApplication.APP_CONFIGS[this.appType];
    const subgraphs: { [key: string]: any } = {};

    config.subgraphs.forEach((subgraphConfig) => {
      subgraphs[subgraphConfig.name] = {
        agentSubGraph: new subgraphConfig.Graph(
          +this.clientData[0],
          [this.clientAgentFunction],
          this.clientData[1],
          this.schema
        ),
      };
    });

    return { subgraphs, systemPrompt: config.systemPrompt };
  }

  async processTask(task: string, thread_id?: string): Promise<void> { 
    let config = { 
      streamMode: 'values',
      recursion_limit: 2,
      configurable: {}
    };
    if (thread_id) {
      config.configurable = { thread_id }
    } 
    await this.graphManager.getApp().invoke({ task: task, thread_id: thread_id }, config); 
  }

  public async initialize(): Promise<void> {
    await this.initializeGraphManager(this.schema, this.appType );
  }
}