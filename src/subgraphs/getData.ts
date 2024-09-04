import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, getFieldDetails, getExampleRelatedCards, createMetabaseCard, executeMetabaseQuery, getReasoning } from './nodes/cardLogic';
import Logger from '../utils/Logger';
import { checkUpdateSemanticLayer, handleEditCubeGraph } from './nodes/semanticLayerLogic';
import { createNodeResponse } from '../utils/NodeResponseUtils';

interface DataRecoveryState extends BaseState {
  task: string;
  metabaseQuery: any;
  feedbackMessage: string;
  finalResult: string;
  queryAttempts: number;
  sessionToken: string;
  schema: any[];
  cardId: number;
  queryResult: any;
  fieldDetails: Record<number, any>; 
  exampleRelatedCards: string;
  stopExecution: boolean;
  needsSemanticUpdate: boolean;
  semanticTask: string; 
  isPossible: string;
}
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  private database: number;
  private companyName: string;

  constructor(database: number, functions: Function[], companyName: string) {
    const graphState: StateGraphArgs<DataRecoveryState>['channels'] = {
      task: {
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
      finalResult: {  
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      queryAttempts: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      sessionToken: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      schema: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      cardId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      queryResult: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      fieldDetails: {  
        value: (x: Record<number, any>, y?: Record<number, any>) => (y ? y : x),
        default: () => ({}),
      },
      exampleRelatedCards: {  
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      stopExecution: {  
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
      needsSemanticUpdate: {
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
      semanticTask: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      isPossible: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      }
    };
    super(graphState);
    this.functions = functions;
    this.database = database;
    this.companyName = companyName;
  }

  private async fetchSchemaNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const { sessionToken, schema } = await fetchSchema(this.companyName, this.database);

    if (schema) {
      this.functions[0]('info', createNodeResponse('data', { message: "Schema successfully retrieved", data: {numTables: schema.length} }));
    } else {
      this.functions[0]('info', createNodeResponse('error', { message: "Schema could not be retrieved" }));
    }

    return { ...state, sessionToken, schema };
  }

  private async checkUpdateSemanticLayer(state: DataRecoveryState): Promise<DataRecoveryState> {
    const {needsSemanticUpdate, semanticTask} = await checkUpdateSemanticLayer(state.task, this.companyName);
    if (needsSemanticUpdate) {
      this.functions[0]('info', createNodeResponse('data', { message: "Successfully identified required semantic layer updates" }));
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: "Semantic layer does not need updates" }));
    }
    return { ...state, needsSemanticUpdate, semanticTask };
  }

  private async handleEditCubeGraph(state: DataRecoveryState): Promise<DataRecoveryState> {
    const { schema, result } = await handleEditCubeGraph(state.semanticTask, state.sessionToken, this.functions, this.database, this.companyName);
    this.functions[0]('info', createNodeResponse('data', { message: "Semantic layer edited to include required fields missing for query", data: { result } }));
    return { ...state, schema };
  }

  private async evaluateFieldsNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const { fieldDetails, isPossible } = await getFieldDetails(state.task, state.sessionToken, state.schema, this.companyName);
    if (fieldDetails) {
      this.functions[0]('info', createNodeResponse('data', { message: "Appropriate fields identified for query", data: { fieldDetails } }));
    } else {
      this.functions[0]('info', createNodeResponse('error', { message: "No appropriate fields were found for this query" }));
    }
    return { ...state, fieldDetails, isPossible };
  }

  private async evaluateExamplesNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const { exampleRelatedCards, ids } = await getExampleRelatedCards(state.task, state.sessionToken, this.database, this.companyName, state.feedbackMessage);
    if (ids) {
      this.functions[0]('info', createNodeResponse('data', { message: "Example cards related to the task have been identified", data: { exampleCardIds: ids } }));
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: "Using fallback example cards for task"}));
    }
    return { ...state, exampleRelatedCards };
  }

  private async createCardNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const queryAttempts =  (state.queryAttempts || 0) + 1;
    if (queryAttempts > 3) {
      Logger.log("Unable to generate a suitable query after 3 attempts.")
      return {
        ...state,
        queryAttempts, 
        finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + state.feedbackMessage,
      }
    }
    const result = await createMetabaseCard(state.task, state.sessionToken, state.schema, state.fieldDetails, state.exampleRelatedCards, this.companyName, state.feedbackMessage, state.metabaseQuery);

    if ('error' in result) {
      this.functions[0]('info', createNodeResponse('error', { message: result.error }));
      return {
        ...state,
        feedbackMessage: result.error,
        metabaseQuery: result.metabaseQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: `Metabase card created with ID ${result.cardId}`, data: { cardId: result.cardId } }));
      return {
        ...state,
        cardId: result.cardId!,
        metabaseQuery: result.metabaseQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    }
  }

  private async executeQueryNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const result = await executeMetabaseQuery(state.sessionToken, state.cardId, state.metabaseQuery, this.companyName);
    
    if ('error' in result) {
      const stopExecution = result.error.includes("Can't find join path");
      
      this.functions[0]('info', createNodeResponse('error', { message: result.error }));
      return {
        ...state,
        feedbackMessage: result.error,
        metabaseQuery: result.metabaseQuery,
        stopExecution: stopExecution,
      };
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: "Query executed successfully", data: { cardId: state.cardId } }));
      return {
        ...state,
        queryResult: result.queryResult,
      };
    }
  }

  private async getReasoningNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const result = await getReasoning( state.queryResult, state.task, state.metabaseQuery, state.cardId, state.fieldDetails, state.schema);

    this.functions[0]('info', createNodeResponse('data', { message: "Result insights and explanation prepared", data: { cardId: state.cardId } }));
    const getDatasetQuery = [
      {
        function_name: 'getDatasetQuery',
        arguments: {
          cardId: state.cardId,
          reasoning: result.reasoning,
          sources: result.sources
        }
      },
    ];

    this.functions[0]('tool', getDatasetQuery);

    return {
      ...state,
      finalResult: state.queryAttempts > 1 ? result.finalResult + " Is this what you were looking for?" : result.finalResult,
    };
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', this.fetchSchemaNode.bind(this))
      .addNode('evaluate_fields', this.evaluateFieldsNode.bind(this))
      .addNode('evaluate_examples', this.evaluateExamplesNode.bind(this))
      .addNode('check_update_semantic_layer', this.checkUpdateSemanticLayer.bind(this))
      .addNode('edit_cube_graph', this.handleEditCubeGraph.bind(this))
      .addNode('create_card', this.createCardNode.bind(this))
      .addNode('execute_query', this.executeQueryNode.bind(this))
      .addNode('getReasoning', this.getReasoningNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'evaluate_fields')
      .addEdge('fetch_schema', 'evaluate_examples')
      .addConditionalEdges('evaluate_fields', (state: { isPossible: string }) => {
        if (state.isPossible === 'yes') {
          return 'create_card';
        } else {
          return 'check_update_semantic_layer';
        }
      })
      .addConditionalEdges('check_update_semantic_layer', (state: { needsSemanticUpdate: boolean }) => {
        if (state.needsSemanticUpdate) {
          return 'edit_cube_graph';
        } else {
          return 'create_card';
        }
      })
      .addEdge('edit_cube_graph', 'create_card')
      .addEdge('evaluate_examples', 'create_card')
      .addConditionalEdges('create_card', (state: DataRecoveryState) => {
        if (state.queryAttempts > 3) {
          return END;
        } else if (!state.cardId) {
          return 'create_card';
        } else {
          return 'execute_query';
        }
      })
      .addConditionalEdges('execute_query', (state: DataRecoveryState) => {
        if (state.queryAttempts > 3 || state.stopExecution) {
          return END;
        } else if (state.queryResult && !("error" in state.queryResult)) {
          return 'getReasoning';
        } else {
          return 'create_card';
        }
      })
      .addEdge('getReasoning', END);

    return subGraphBuilder.compile();
  }
}