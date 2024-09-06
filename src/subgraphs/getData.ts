import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { getExampleRelatedCards } from './nodes/cardLogic';
import { createNodeResponse } from '../utils/NodeResponseUtils';
import Logger from '../utils/Logger';
import { createMessage, createThread, pollRun } from '../services/AssistantsOpenAI';
import { generateCombinedJSON, getMetabaseJSON } from '../utils/DataStructure';
import { authenticate, createCard, getDatasetQuery } from '../services/MetabaseAPI';
import { ConfigurationManager } from '../utils/ConfigurationManager';

interface DataRecoveryState extends BaseState {
  task: string;
  metabaseQuery: any;
  queryStructure: any;
  queryAttempts: number;
  cardId: number;
  exampleRelatedCards: string;
}
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  private database: number;
  private companyName: string;
  private resultsMap: Record<string, any>;
  private resultsIdsMap: Record<string, any>;
  private schema: any[];
  private sessionToken: string;
  constructor(database: number, functions: Function[], companyName: string, schema: any[]) {
    const graphState: StateGraphArgs<DataRecoveryState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      metabaseQuery: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      queryStructure: {
        value: (x: any, y?: any) => (y ? y : x),
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
      cardId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      exampleRelatedCards: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
    };
    super(graphState);
    this.functions = functions;
    this.database = database;
    this.companyName = companyName;
    this.resultsMap = {};
    this.resultsIdsMap = {};
    this.onRequiresAction = this.onRequiresAction.bind(this);
    this.createCardNode = this.createCardNode.bind(this);
    this.onRequiresAction = this.onRequiresAction.bind(this);
    this.createCardNode = this.createCardNode.bind(this);
    this.sessionToken = '';
    this.schema = schema;
  }

  async initialize(): Promise<void> {
    try {
      const sessionToken = await authenticate(this.companyName);
      this.sessionToken = sessionToken;
      if (sessionToken) {
        Logger.log('Authenticated successfully');
      } else {
        this.functions[0]('info', createNodeResponse('error', { message: "Sorry could not authenticate" }));
      }
    } catch (error) {
      console.error("Error fetching schema:", error);
      this.functions[0]('info', createNodeResponse('error', { message: "Error fetching schema" }));
    }
  }

  private async evaluateExamplesNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const { exampleRelatedCards, ids } = await getExampleRelatedCards();
    if (ids) {
      this.functions[0]('info', createNodeResponse('data', { message: "Example cards related to the task have been identified", data: { exampleCardIds: ids } }));
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: "Using fallback example cards for task" }));
    }
    return { ...state, exampleRelatedCards };
  }

  private async onRequiresAction(
    runStatus: any,
    schema: any,
    companyName: string,
    sessionToken: string,
    dbId: number,
  ): Promise<any[]> {
    const toolOutputs = [];
    if (
      runStatus.required_action &&
      runStatus.required_action.submit_tool_outputs &&
      runStatus.required_action.submit_tool_outputs.tool_calls
    ) {
      for (const tool of runStatus.required_action.submit_tool_outputs.tool_calls) {
        if (tool.function.name === "generateQueryStructure") {
          const query = JSON.parse(tool.function.arguments);
          try {
            const metabaseJSON = await getMetabaseJSON(query, schema, dbId);
            try {
              const tableResult = await getDatasetQuery(companyName, sessionToken, JSON.stringify(metabaseJSON));
              this.resultsMap[runStatus.id] = metabaseJSON;
              toolOutputs.push({
                tool_call_id: tool.id,
                output: JSON.stringify(tableResult),
              });
            } catch (e) {

              if (e instanceof Error) {
                Logger.error(e.message);
                toolOutputs.push({
                  tool_call_id: tool.id,
                  output: e.message
                });
                this.functions[0]('info', createNodeResponse('data', { message: "We had a problem creating the card. We are trying again." }));
              }
            }

          } catch (e) {
            if (e instanceof Error) {
              Logger.error(e.message);
              toolOutputs.push({
                tool_call_id: tool.id,
                output: e.message
              });
              this.functions[0]('info', createNodeResponse('data', { message: "We had a problem creating the card. We are trying again." }));
            }
          }
        } else if (tool.function.name === "createCard") {
          const query = JSON.parse(tool.function.arguments);
          const metabaseJSON = this.resultsMap[runStatus.id];
          const requestJSON = generateCombinedJSON(query, metabaseJSON);
          const request = JSON.stringify(requestJSON, null, 2);
          const cardIdResponse = await createCard(companyName, sessionToken, request);
          this.resultsIdsMap[runStatus.id] = cardIdResponse;

          toolOutputs.push({
            tool_call_id: tool.id,
            output: request,
          });
        } else {
          toolOutputs.push({
            tool_call_id: tool.id,
            output: "0",
          });
        }
      }
    }

    return toolOutputs;
  };

  private async createCardNode(state: DataRecoveryState): Promise<DataRecoveryState> {
    const threadId = await createThread();

    const queryGuidelines = `
The schema of the database is:
${JSON.stringify(this.schema, null, 2)}

You can only use the tables and fields that are provided in the schema.

Ensure that the query is well-formed, syntactically correct, and meets the requirements of the task.
When applying filters, try to apply "is not empty" filters and prioritize "contains" filters over "equals" filters.

Try to leverage the "CubeJoinField" fields that all tables have to join source tables.
When available, try to use names instead of IDs for visualizations, even if a new join is necessary to get an item's name.
For aggregations of type sum, use fields named starting with 'total' (e.g., totalAmount), if not available raise an error.
For aggregations of type average, use fields named starting with 'average' (e.g., averageAmount), if not available raise an error.
       
Here are some examples of a natural language query and its corresponding JSON representation (which used other tables you may not be able to use):

${state.exampleRelatedCards}
`;


    state.task = `${state.task}\n\n${queryGuidelines}\n`;
    await createMessage(threadId, state.task);
    const config = ConfigurationManager.getConfig(this.companyName);
    const assistantId = config.DATA_ASSISTANT_KEY;

    await pollRun(
      threadId,
      assistantId,
      (tool: any) => {
        Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`);
      },
      (content: any, snapshot: any) => Logger.log(`\nIMAGE FILE DONE > ${JSON.stringify(content, null, 2)}\n\n`),
      (content: any, snapshot: any) => {
        const runId = snapshot.run_id;
        if (this.resultsMap[runId]) {
          const metabaseJSON = this.resultsMap[runId];
          const cardIdResponse = this.resultsIdsMap[runId];
          state.cardId = cardIdResponse;
          state.metabaseQuery = metabaseJSON;
          state.queryAttempts = state.queryAttempts + 1
          this.functions[0]('result', createNodeResponse('data', { message: content, data: { cardIdResponse } }));
          delete this.resultsMap[runId];
          delete this.resultsIdsMap[runId];
        }
      },
      this.onRequiresAction,
      this.schema,
      this.companyName,
      this.sessionToken,
      this.database
    );
    return { ...state }
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('evaluate_examples', this.evaluateExamplesNode.bind(this))
      .addNode('create_card', this.createCardNode.bind(this))
      .addEdge(START, 'evaluate_examples')
      .addEdge('evaluate_examples', 'create_card')
      .addEdge('create_card', END)
    return subGraphBuilder.compile();
  }

  getApp(): any {
    return this.getGraph();
  }
}