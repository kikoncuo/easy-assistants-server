import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, evaluateFieldRequirements, createMetabaseCard, executeMetabaseQuery, getReasoning } from './nodes/cardNodes';
import Logger from '../utils/Logger';

// Define a specific state type
interface DataRecoveryState extends BaseState {
  metabaseQuery: any;
  feedbackMessage: string | null;
  finalResult: string;
  queryAttempts: number;
  sessionToken: string;
  schema: any[];
  cardId: number;
  queryResult: any;
  fieldDetails: Record<number, any>; 
  stopExecution: boolean;
}

export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  private database: number;

  constructor(database: number, functions: Function[]) {
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
        value: (x: string | null, y?: string | null) => (y ? y : x),
        default: () => null,
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
      stopExecution: {  
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => (false),
      },
    };
    super(graphState);
    this.functions = functions;
    this.database = database;
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', async (state: DataRecoveryState) => await fetchSchema(state, this.database))
      .addNode('evaluate_fields', async (state: DataRecoveryState) => await evaluateFieldRequirements(state))
      .addNode('create_card', async (state: DataRecoveryState) => await createMetabaseCard(state, this.database))
      .addNode('execute_query', async (state: DataRecoveryState) => await executeMetabaseQuery(state))
      .addNode('getReasoning', async (state: DataRecoveryState) => await getReasoning(state, this.functions))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'evaluate_fields')
      .addEdge('evaluate_fields', 'create_card')
      .addConditionalEdges('create_card', (state: { queryAttempts: number; cardId: any; }) => {
        if (state.queryAttempts > 3) {
          return END;
        } else if (!state.cardId) {
          return 'create_card';
        } else {
          return 'execute_query';
        }
      })
      .addConditionalEdges('execute_query', (state: { queryAttempts: number; queryResult: any; stopExecution: boolean; }) => {
        if (state.queryAttempts > 3 || state.stopExecution) {
          return END;
        } else if (state.queryResult && !("error" in state.queryResult)) {
          return 'getReasoning';
        } else {
          return 'create_card';
        }
      })
      .addEdge('getReasoning', END)
    return subGraphBuilder.compile();
  }
}