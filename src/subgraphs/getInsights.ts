import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import Logger from '../utils/Logger';
import { addFilters, createMetabaseCard, fetchSchema, getFieldDetails, getResults, identifyRelevantSources, evaluateCards, executeMetabaseQuery, getResultsForFilteredCards } from './nodes/cardLogic';

interface InsightState extends BaseState {
  sessionToken: string;
  schema: any[];
  relevantCards: any[]; 
  responses: string[];
  fieldDetails: Record<number, any>; 
  metabaseQuery: any;
  feedbackMessage: string;
  isPossible: string;
  queryAttempts: number;
  cardId: number;
  stopExecution: boolean;
  queryResult: any;
  newCardDescription: string;
  modifiedCards: any[];
  finalResult: string;
}

export class InsightGraph extends AbstractGraph<InsightState> {
  private databaseId: number;
  private functions: Function[];
  private companyName: string;

  constructor(databaseId: number, functions: Function[], companyName: string) {
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
      metabaseQuery: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      feedbackMessage: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      fieldDetails: {  
        value: (x: Record<number, any>, y?: Record<number, any>) => (y ? y : x),
        default: () => ({}),
      },
      relevantCards: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      responses: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      isPossible: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      queryAttempts: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      cardId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      stopExecution: {  
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
      queryResult: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      newCardDescription: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      modifiedCards: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
    };
    super(graphState);
    this.functions = functions;
    this.databaseId = databaseId;
    this.companyName = companyName;
  }

  private async fetchSchemaNode(state: InsightState): Promise<InsightState> {
    const { sessionToken, schema } = await fetchSchema(this.companyName, this.databaseId);
    return { ...state, sessionToken, schema };
  }

  private async evaluateFieldsNode(state: InsightState): Promise<InsightState> {
    const { fieldDetails, isPossible } = await getFieldDetails(state.task, state.sessionToken, state.schema, this.companyName);
    return { ...state, fieldDetails, isPossible };
  }

  private async identifyRelevantSourcesNode(state: InsightState): Promise<InsightState> {
    const relevantCards = await identifyRelevantSources(state.task, state.sessionToken, this.databaseId, state.schema, this.companyName);

    if (relevantCards.length > 0) {
      return {
        ...state,
        relevantCards: relevantCards,
      };
    } else {
      Logger.log("No relevant cards found to create the insights")
      return {
        ...state,
        relevantCards: []
      };
    }
  }

  private async evaluateCardsNode(state: InsightState): Promise<InsightState> {
    const { areCardsEnough, newCardDescription } = await evaluateCards(
      state.task, 
      state.sessionToken, 
      state.relevantCards, 
      this.databaseId, 
      this.companyName
    );
  
    if (areCardsEnough) {
      return {
        ...state,
        isPossible: 'yes'
      };
    } else {
      return {
        ...state,
        isPossible: 'no',
        newCardDescription: newCardDescription
      };
    }
  }

  private async createCardNode(state: InsightState): Promise<InsightState> {

    const queryAttempts =  (state.queryAttempts || 0) + 1;
    if (queryAttempts > 3) {
      Logger.log("Unable to generate a suitable query after 3 attempts.")
      return {
        ...state,
        queryAttempts, 
        finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + state.feedbackMessage
      }
    }

    const result = await createMetabaseCard(state.task, state.sessionToken, state.schema, state.fieldDetails, this.databaseId, this.companyName, state.feedbackMessage, state.metabaseQuery, state.newCardDescription);

    if ('error' in result) {
      return {
        ...state,
        feedbackMessage: result.error,
        metabaseQuery: result.metabaseQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    } else {
      return {
        ...state,
        cardId: result.cardId,
        metabaseQuery: result.metabaseQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    }
  }

  private async executeQueryNode(state: InsightState): Promise<InsightState> {
    const result = await executeMetabaseQuery(state.sessionToken, state.cardId, state.metabaseQuery, this.companyName);
    Logger.log('executeQueryNode',result)
    if ('error' in result) {
      const stopExecution = result.error.includes("Can't find join path");
      
      return {
        ...state,
        feedbackMessage: result.error,
        metabaseQuery: result.metabaseQuery,
        stopExecution: stopExecution
      };
    } else {
      return {
        ...state,
        queryResult: result.queryResult,
      };
    }
  }

  private async addFilterNode(state: InsightState): Promise<InsightState> {
    const updatedCards = await addFilters(state.task, state.sessionToken, this.databaseId, state.schema, state.relevantCards, this.companyName)
    Logger.log('updatedCards',updatedCards)
    return {
      ...state,
      modifiedCards: updatedCards,
    }
  }

  private async getResultsNode(state: InsightState): Promise<InsightState> {
    let insights = [];
    if(state.modifiedCards.length > 0)  {
      insights = await getResultsForFilteredCards(state.task, state.sessionToken, this.databaseId, state.schema, state.relevantCards, this.companyName, state.modifiedCards)
    } else {
      insights = await getResults(state.task, state.sessionToken, this.databaseId, state.schema, state.relevantCards, this.companyName)
    }
    Logger.log('insights',insights)
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
      .addNode('evaluate_fields', this.evaluateFieldsNode.bind(this))
      .addNode('evaluate_cards', this.evaluateCardsNode.bind(this))
      .addNode('create_card', this.createCardNode.bind(this))
      .addNode('add_filters', this.addFilterNode.bind(this))
      .addNode('execute_query', this.executeQueryNode.bind(this))
      .addNode('get_results', this.getResultsNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'identify_sources')
      .addConditionalEdges('identify_sources', (state) => {
        if (state.relevantCards.length >= 1) {
          return 'evaluate_cards';
        } else {
          return 'evaluate_fields';
        }
      })
      .addConditionalEdges('evaluate_cards', (state) => {
        if (state.isPossible === 'yes') {
          return 'add_filters';
        } else {
          return 'evaluate_fields';
        }
      })
      .addEdge('evaluate_fields', 'create_card')
      .addConditionalEdges('create_card', (state: InsightState) => {
        if (state.queryAttempts > 3) {
          return END;
        } else if (!state.cardId) {
          return 'create_card';
        } else {
          return 'execute_query';
        }
      })
      .addConditionalEdges('execute_query', (state: InsightState) => {
        if (state.queryAttempts > 3 || state.stopExecution) {
          return END;
        } else if (state.queryResult && !("error" in state.queryResult)) {
          return 'get_results';
        } else {
          return 'create_card';
        }
      })
      .addEdge('add_filters', 'get_results')
      .addEdge('get_results', END);

    return subGraphBuilder.compile();
  }
}
