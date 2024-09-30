import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, getFieldDetails, getExampleRelatedCards, createMetabaseCard, executeMetabaseQuery, getReasoning } from './nodes/cardLogic';
import Logger from '../utils/Logger';
import { checkUpdateSemanticLayer, getSuggestionForAskedQuestion } from './nodes/semanticLayerLogic';
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
    this.functions[0]('info', createNodeResponse('data', { message: "Retrieving schema" }));

    const { sessionToken, schema } = await fetchSchema(this.companyName, this.database);

    if (!schema) {
      this.functions[0]('info', createNodeResponse('error', { message: "Schema could not be retrieved" }));
    }

    return { ...state, sessionToken, schema };
  }

  private async checkUpdateSemanticLayer(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[0]('info', createNodeResponse('data', { message: "Checking if modifications are required in the semantic layer" }));

    const { needsSemanticUpdate, semanticTask } = await checkUpdateSemanticLayer(state.task, this.companyName);
    if (needsSemanticUpdate) {
      const { suggestion } = await getSuggestionForAskedQuestion(state.schema, state.task);
      this.functions[0]('info', createNodeResponse('error',
        { message: `To complete this task, the semantic layer needs to be updated with the following field: ${semanticTask}. Please reach out to support for assistance. \nHere is a suggestion related to your original query: ${suggestion}` }
      ));
    } 

    return {
      ...state,
      needsSemanticUpdate,
      semanticTask,
      finalResult: needsSemanticUpdate ? "The semantic layer needs an update to complete the task" : state.finalResult
    };
  }

  private async evaluateFieldsNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[0]('info', createNodeResponse('data', { message: "Identifying appropriate fields for the query" }));
    
    const { fieldDetails, isPossible } = await getFieldDetails(state.task, state.sessionToken, state.schema, this.companyName);
    
    if (!fieldDetails) {
      this.functions[0]('info', createNodeResponse('error', { message: "No appropriate fields were found for this query" }));
    }
    return { ...state, fieldDetails, isPossible };
  }

  private async evaluateExamplesNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[0]('info', createNodeResponse('data', { message: "Identifying example cards related to the task" }));

    const { exampleRelatedCards, ids } = await getExampleRelatedCards(state.task, state.sessionToken, this.database, this.companyName, state.feedbackMessage);
    
    if (!ids) {
      this.functions[0]('info', createNodeResponse('data', { message: "Using fallback example cards for task" }));
    }
    return { ...state, exampleRelatedCards };
  }

  private async createCardNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[0]('info', createNodeResponse('data', { message: "Creating Omniloy card" }));

    const queryAttempts = (state.queryAttempts || 0) + 1;
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
      return {
        ...state,
        cardId: result.cardId!,
        metabaseQuery: result.metabaseQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    }
  }

  private async executeQueryNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[0]('info', createNodeResponse('data', { message: "Executing query", data: { cardId: state.cardId } }));
    const result = await executeMetabaseQuery(state.sessionToken, state.cardId, state.metabaseQuery, this.companyName);

    if ('error' in result) {
      const stopExecution = result.error.includes("Can't find join path");
      if (stopExecution) {
        this.functions[0]('info', createNodeResponse('error', { message: "Stopping execution", data: { finalError: true } }));
      } else {
        this.functions[0]('info', createNodeResponse('data', { message: result.error }));
      }

      return {
        ...state,
        feedbackMessage: result.error,
        metabaseQuery: result.metabaseQuery,
        stopExecution: stopExecution,
      };
    } else {
      return {
        ...state,
        queryResult: result.queryResult,
      };
    }
  }

  private async getReasoningNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const result = await getReasoning(state.queryResult, state.task, state.metabaseQuery, state.cardId, state.fieldDetails, state.schema);

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

  getGraph(): any {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', this.fetchSchemaNode.bind(this))
      .addNode('evaluate_fields', this.evaluateFieldsNode.bind(this))
      .addNode('evaluate_examples', this.evaluateExamplesNode.bind(this))
      .addNode('check_update_semantic_layer', this.checkUpdateSemanticLayer.bind(this))
      .addNode('create_card', this.createCardNode.bind(this))
      .addNode('execute_query', this.executeQueryNode.bind(this))
      .addNode('getReasoning', this.getReasoningNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'evaluate_examples')
      .addEdge('evaluate_examples', 'evaluate_fields')
      .addConditionalEdges('evaluate_fields', (state: { isPossible: string }) => {
        if (state.isPossible === 'yes') {
          return 'create_card';
        } else {
          return 'check_update_semantic_layer';
        }
      })
      .addConditionalEdges('check_update_semantic_layer', (state: { needsSemanticUpdate: boolean }) => {
        if (state.needsSemanticUpdate) {
          return END;
        } else {
          return 'create_card';
        }
      })
      //.addEdge('evaluate_examples', 'create_card')
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

  getApp(): any {
    return this.getGraph();
  }
}