import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, getFieldDetails, getExampleRelatedCards, createMetabaseCard, executeMetabaseQuery, getReasoning, rewriteTask, createMetabaseSQLCard } from './nodes/cardLogic';
import Logger from '../utils/Logger';
import { checkUpdateSemanticLayer, getSuggestionForAskedQuestion } from './nodes/semanticLayerLogic';
import { createNodeResponse } from '../utils/NodeResponseUtils';
import { fallbackCardExamples, fallbackSQLCardExamples } from '../utils/CardExamples';
import { formatExampleCards, formatExampleSQLCards } from '../utils/MetabaseAPI';

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
  exampleRelatedCards: any[];
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
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
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
    this.database = 11;
    this.companyName = companyName;
  }

  private async fetchSchemaNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[1]('info', createNodeResponse('data', { message: "Retrieving schema" }));

    const { sessionToken, schema } = await fetchSchema(this.companyName, this.database);

    if (!schema) {
      this.functions[1]('info', createNodeResponse('error', { message: "Schema could not be retrieved" }));
    }

    return { ...state, sessionToken, schema };
  }

  private async rewriteTask(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[0]('info', createNodeResponse('data', { message: "Generating task" }));

    const { newTask } = await rewriteTask(state.task, state.schema, state.fieldDetails);

    return {
      ...state, 
      task: newTask
     };
  }

  private async checkUpdateSemanticLayer(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[1]('info', createNodeResponse('data', { message: "Checking if modifications are required in the semantic layer" }));

    const { needsSemanticUpdate, semanticTask } = await checkUpdateSemanticLayer(state.task, this.companyName);
    if (needsSemanticUpdate) {
      const { suggestion } = await getSuggestionForAskedQuestion(state.schema, state.task);
      this.functions[1]('info', createNodeResponse('error',
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
    this.functions[1]('info', createNodeResponse('data', { message: "Identifying appropriate fields for the query" }));
    
    const { fieldDetails, isPossible } = await getFieldDetails(state.task, state.sessionToken, state.schema, this.companyName);
    
    if (!fieldDetails) {
      this.functions[1]('info', createNodeResponse('error', { message: "No appropriate fields were found for this query" }));
    }
    return { ...state, fieldDetails, isPossible };
  }

  private async evaluateExamplesNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[1]('info', createNodeResponse('data', { message: "Identifying example cards related to the task" }));

    const { exampleRelatedCards, ids } = await getExampleRelatedCards(state.task, state.sessionToken, this.database, this.companyName, state.feedbackMessage);
    
    if (!ids) {
      this.functions[1]('info', createNodeResponse('data', { message: "Using fallback example cards for task" }));
    }
    return { ...state, exampleRelatedCards };
  }

  private async createCardNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[1]('info', createNodeResponse('data', { message: "Creating Omniloy card" }));

    const queryAttempts = (state.queryAttempts || 0) + 1;
    if (queryAttempts > 3) {
      Logger.log("Unable to generate a suitable query after 3 attempts.")
      return {
        ...state,
        queryAttempts,
        finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + state.feedbackMessage,
      }
    }

    let relatedCards = "";
    if (state.exampleRelatedCards) {
      relatedCards = formatExampleCards(state.exampleRelatedCards)
    } else {
      relatedCards = fallbackCardExamples(this.database);
    }
    const result = await createMetabaseCard(state.task, state.sessionToken, state.schema, state.fieldDetails, relatedCards, this.companyName, state.feedbackMessage, state.metabaseQuery);

    if ('error' in result) {
      this.functions[1]('info', createNodeResponse('error', { message: result.error }));
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

  private async createSQLCardNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[1]('info', createNodeResponse('data', { message: "Creating Omniloy SQL card" }));

    const queryAttempts = (state.queryAttempts || 0) + 1;
    if (queryAttempts > 3) {
      Logger.log("Unable to generate a suitable query after 3 attempts.")
      return {
        ...state,
        queryAttempts,
        finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + state.feedbackMessage,
      }
    }
    
    let relatedSQLCards = "";
    if (state.exampleRelatedCards) {
      relatedSQLCards = await formatExampleSQLCards(this.companyName, state.sessionToken, state.exampleRelatedCards)
    } else {
      relatedSQLCards = fallbackSQLCardExamples(this.database);
    }

    const result = await createMetabaseSQLCard(state.task, state.sessionToken, state.schema, state.fieldDetails, relatedSQLCards, this.database, this.companyName, state.feedbackMessage, state.metabaseQuery);

    if ('error' in result) {
      this.functions[1]('info', createNodeResponse('error', { message: result.error }));
      return {
        ...state,
        feedbackMessage: result.error,
        metabaseQuery: result.sqlQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    } else {
      return {
        ...state,
        cardId: result.cardId!,
        metabaseQuery: result.sqlQuery,
        queryAttempts: state.queryAttempts + 1,
      };
    }
  }

  private async executeQueryNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    this.functions[1]('info', createNodeResponse('data', { message: "Executing query", data: { cardId: state.cardId } }));
    const result = await executeMetabaseQuery(state.sessionToken, state.cardId, state.metabaseQuery, this.companyName);

    if ('error' in result) {
      const stopExecution = result.error.includes("Can't find join path");
      if (stopExecution) {
        this.functions[1]('info', createNodeResponse('error', { message: "Stopping execution", data: { finalError: true } }));
      } else {
        this.functions[1]('info', createNodeResponse('data', { message: result.error }));
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

    if (state.isPossible === 'maybe') {
      const { suggestion } = await getSuggestionForAskedQuestion(state.schema, state.task);
      this.functions[1]('info', createNodeResponse('error',
        { message: `This information may not be accurate. Please review it or try again using the following suggestion: ${suggestion}` }
      ));
    }

    return {
      ...state,
      finalResult: state.queryAttempts > 1 ? result.finalResult + " Is this what you were looking for?" : result.finalResult,
    };
  }

  getGraph(): any {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', this.fetchSchemaNode.bind(this))
      .addNode('rewrite_task', this.rewriteTask.bind(this))
      .addNode('evaluate_fields', this.evaluateFieldsNode.bind(this))
      .addNode('evaluate_examples', this.evaluateExamplesNode.bind(this))
      .addNode('check_update_semantic_layer', this.checkUpdateSemanticLayer.bind(this))
      .addNode('create_sql_card', this.createSQLCardNode.bind(this))
      .addNode('create_card', this.createCardNode.bind(this))
      .addNode('execute_query', this.executeQueryNode.bind(this))
      .addNode('getReasoning', this.getReasoningNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'evaluate_fields')
      .addEdge('evaluate_fields', 'evaluate_examples')
      .addEdge('evaluate_examples', 'rewrite_task')
      .addConditionalEdges('rewrite_task', (state: { isPossible: string }) => {
        if (state.isPossible === 'yes') {
          return 'create_card';
        } else {
          return 'create_sql_card';
        }
      })
      .addConditionalEdges('create_card', (state: DataRecoveryState) => {
        if (state.queryAttempts > 3) {
          return END;
        } else if (!state.cardId) {
          return 'create_card';
        } else {
          return 'execute_query';
        }
      })
      .addConditionalEdges('create_sql_card', (state: DataRecoveryState) => {
        if (state.queryAttempts > 3) {
          return 'check_update_semantic_layer';
        } else if (!state.cardId) {
          return 'create_sql_card';
        } else {
          return 'execute_query';
        }
      })
      .addEdge('check_update_semantic_layer', END)
      .addConditionalEdges('execute_query', (state: DataRecoveryState) => {
        if (state.queryAttempts > 3 || state.stopExecution) {
          return END;
        } else if (state.queryResult && !("error" in state.queryResult)) {
          return 'getReasoning';
        } else {
          return state.isPossible === 'yes' ? 'create_card' : 'create_sql_card';
        }
      })
      .addEdge('getReasoning', END);

      return subGraphBuilder.compile();
  }

  getApp(): any {
    return this.getGraph();
  }
}