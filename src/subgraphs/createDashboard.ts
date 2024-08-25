import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { 
  createCardDescriptions, 
  createMultipleCardsAndSaveEmbeddings, 
  createMetabaseDashboard 
} from './nodes/dashboardLogic';
import { fetchSchema, getFieldDetails } from './nodes/cardLogic';
import Logger from '../utils/Logger';

interface DashboardCreationState extends BaseState {
  task: string;
  sessionToken: string;
  schema: any[];
  fieldDetails: Record<number, any>; 
  cardDescriptions: string[];
  createdCards: any[];
  dashboardId: number;
  finalDashboard: any;
  finalResult: string;
}

export class CreateDashboardGraph extends AbstractGraph<DashboardCreationState> {
  private functions: Function[];
  private databaseId: number;

  constructor(databaseId: number, functions: Function[]) {
    const graphState: StateGraphArgs<DashboardCreationState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      sessionToken: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      schema: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      fieldDetails: {  
        value: (x: Record<number, any>, y?: Record<number, any>) => (y ? y : x),
        default: () => ({}),
      },
      cardDescriptions: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      createdCards: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      dashboardId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      finalDashboard: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
    };
    super(graphState);
    this.functions = functions;
    this.databaseId = databaseId;
  }

  private async fetchSchemaNode(state: DashboardCreationState): Promise<DashboardCreationState> {
    const { sessionToken, schema } = await fetchSchema(this.databaseId);
    return { ...state, sessionToken, schema };
  }

  private async getFieldDetailsNode(state: DashboardCreationState): Promise<DashboardCreationState> {
    const fieldDetails = await getFieldDetails(state.task, state.sessionToken, state.schema);
    return { ...state, fieldDetails };
  }

  private async createCardDescriptionsNode(state: DashboardCreationState): Promise<DashboardCreationState> {
    const cardDescriptions = await createCardDescriptions(state.task, state.fieldDetails, state.schema);
    return { ...state, cardDescriptions };
  }

  private async createCardsNode(state: DashboardCreationState): Promise<DashboardCreationState> {
    const result = await createMultipleCardsAndSaveEmbeddings(
      state.cardDescriptions,
      state.sessionToken,
      state.schema,
      state.fieldDetails,
      this.databaseId
    );
    if (result.error) {
      Logger.error(result.error);
      return { ...state, finalResult: result.error };
    }
    return { ...state, createdCards: result.createdCards };
  }

  private async createDashboardNode(state: DashboardCreationState): Promise<DashboardCreationState> {
    if (!state.createdCards || state.createdCards.length === 0) {
      const errorMessage = "No cards could be created for the dashboard. Please contact support.";
      Logger.error(errorMessage);
      return { ...state, finalResult: errorMessage };
    }
    const result = await createMetabaseDashboard(state.task, state.sessionToken, state.createdCards);
    if ('error' in result) {
      Logger.error(result.error);
      return { ...state, finalResult: result.error };
    }
    return { 
      ...state, 
      dashboardId: result.dashboardId, 
      finalDashboard: result.finalDashboard,
      finalResult: `Dashboard created successfully with ID: ${result.dashboardId}`
    };
  }

  getGraph(): CompiledStateGraph<DashboardCreationState> {
    const subGraphBuilder = new StateGraph<DashboardCreationState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', this.fetchSchemaNode.bind(this))
      .addNode('get_field_details', this.getFieldDetailsNode.bind(this))
      .addNode('create_card_descriptions', this.createCardDescriptionsNode.bind(this))
      .addNode('create_cards', this.createCardsNode.bind(this))
      .addNode('create_dashboard', this.createDashboardNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'get_field_details')
      .addEdge('get_field_details', 'create_card_descriptions')
      .addEdge('create_card_descriptions', 'create_cards')
      .addEdge('create_cards', 'create_dashboard')
      .addEdge('create_dashboard', END);

    return subGraphBuilder.compile();
  }
}