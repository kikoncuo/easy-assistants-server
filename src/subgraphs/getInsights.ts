import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import Logger from '../utils/Logger';
import { addFilters, fetchSchema, getResults, identifyRelevantSources } from './nodes/cardLogic';

interface InsightState extends BaseState {
  sessionToken: string;
  schema: any[];
  relevantCards: any[]; 
  responses: string[];
  finalResult: string;
}

export class InsightGraph extends AbstractGraph<InsightState> {
  private databaseId: number;
  private functions: Function[];

  constructor(databaseId: number, functions: Function[]) {
    const graphState: StateGraphArgs<InsightState>['channels'] = {
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
      finalResult: {  
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      relevantCards: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      responses: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      }
    };
    super(graphState);
    this.functions = functions;
    this.databaseId = databaseId;
  }

  private async fetchSchemaNode(state: InsightState): Promise<InsightState> {
    const { sessionToken, schema } = await fetchSchema(this.databaseId);
    return { ...state, sessionToken, schema };
  }

  private async identifyRelevantSourcesNode(state: InsightState): Promise<InsightState> {
    const relevantCards = await identifyRelevantSources(state.task, state.sessionToken, this.databaseId, state.schema);

    if (relevantCards.length > 0) {
      return {
        ...state,
        relevantCards: relevantCards,
      };
    } else {
      Logger.log("No relevant cards found to create the insights")
      return {
        ...state,
        finalResult: "No relevant cards found to create the insights"
      };
    }
  }

  private async addFilterNode(state: InsightState): Promise<InsightState> {
    const updatedCards = await addFilters(state.task, state.sessionToken, this.databaseId, state.schema, state.relevantCards)
    return {
      ...state,
      relevantCards: updatedCards,
    }
  }

  private async getResultsNode(state: InsightState): Promise<InsightState> {
    const insights = await getResults(state.task, state.sessionToken, this.databaseId, state.schema, state.relevantCards)
    const getInsights = [
      {
        function_name: 'getInsights',
        arguments: {
          insights: insights
        }
      },
    ];
    this.functions[0]('tool', getInsights);
   
    return {
      ...state,
      finalResult: JSON.stringify(insights)
    };
  }

  getGraph(): CompiledStateGraph<InsightState> {
    const subGraphBuilder = new StateGraph<InsightState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', this.fetchSchemaNode.bind(this))
      .addNode('identify_sources', this.identifyRelevantSourcesNode.bind(this))
      .addNode('add_filters', this.addFilterNode.bind(this))
      .addNode('get_results', this.getResultsNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'identify_sources')
      .addConditionalEdges('identify_sources', (state) => {
        if (state.relevantCards.length > 0) {
          return 'add_filters';
        } else {
          return END;
        }
      })
      .addEdge('add_filters', 'get_results')
      .addEdge('get_results', END);

    return subGraphBuilder.compile();
  }
}
