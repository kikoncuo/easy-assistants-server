import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, getFasterModel } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { ToolDefinition } from '@langchain/core/language_models/base';
import { authenticate, getExampleCards, executeQuery, createDashboard } from '../utils/MetabaseAPI';
import { similaritySearch, addDocuments } from '../utils/EmbeddingUtils';
import { fetchSchema, evaluateFieldRequirements, createMetabaseCard } from './nodes/cardNodes';

interface DashboardCreationState extends BaseState {
  task: string;
  sessionToken: string;
  schema: any[];
  fieldDetails: Record<number, any>; 
  cardDescriptions: string[];
  createdCards: any[];
  dashboardId: number;
  finalDashboard: any;
}

export class CreateDashboardGraph extends AbstractGraph<DashboardCreationState> {
  private functions: Function[];
  private database: number;

  constructor(database: number, functions: Function[]) {
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
    this.database = database;
  }

  getGraph(): CompiledStateGraph<DashboardCreationState> {
    const subGraphBuilder = new StateGraph<DashboardCreationState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', async (state) => await fetchSchema(state, this.database))
      .addNode('get_relevant_sources', async (state) => await evaluateFieldRequirements(state))
      .addNode('create_card_descriptions', async (state) => await createCardDescriptions(state, this.database))
      .addNode('create_cards_and_save_embeddings', async (state) => await createCardsAndSaveEmbeddings(state, this.database))
      .addNode('create_dashboard', async (state) => await createMetabaseDashboard(state))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'get_relevant_sources')
      .addEdge('get_relevant_sources', 'create_card_descriptions')
      .addEdge('create_card_descriptions', 'create_cards_and_save_embeddings')
      .addEdge('create_cards_and_save_embeddings', 'create_dashboard')
      .addEdge('create_dashboard', END)

    return subGraphBuilder.compile();
  }
}

async function createCardDescriptions(state: DashboardCreationState, databaseId: number): Promise<DashboardCreationState> {
  const generateCardDescriptions: ToolDefinition = {
    type: "function",
    function: {
      name: "generateCardDescriptions",
      description: "Generate descriptions for insightful cards to be included in the dashboard.",
      parameters: {
        type: "object",
        properties: {
          cardDescriptions: {
            type: "array",
            description: "An array of card descriptions.",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                queryType: { 
                  type: "string",
                  enum: ["table", "bar", "line", "pie", "scatter", "area", "funnel", "map"]
                },
                relevantSources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      tableName: { type: "string" },
                      fields: { 
                        type: "array",
                        items: { type: "string" }
                      }
                    },
                    required: ["tableName", "fields"]
                  }
                }
              },
              required: ["title", "description", "queryType", "relevantSources"]
            }
          },
        },
        required: ["cardDescriptions"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [generateCardDescriptions]);

  // Get example cards for reference
  const filter = { databaseID: databaseId };
  const similaritySearchWithScoreResults = await similaritySearch(state.task, 3, filter);
  let ids = similaritySearchWithScoreResults.map(([doc, score]) => doc.metadata.id);
  const exampleCards = await getExampleCards(state.sessionToken, ids);

  const message = await model.invoke([
    new HumanMessage(`Create descriptions for 3-5 insightful cards to be included in a dashboard based on the task: "${state.task}". 
    Use the following field details: ${JSON.stringify(state.fieldDetails, null, 2)}
    
    Here are some example cards for reference:
    ${JSON.stringify(exampleCards, null, 2)}
    
    Ensure that the cards provide a comprehensive view of the data and address the main points of the task. 
    Include a mix of visualization types that best represent the data and insights.`)
  ]);

  const cardDescriptions = message.lc_kwargs.tool_calls[0].args.cardDescriptions;

  return {
    ...state,
    cardDescriptions,
  };
}

async function createCardsAndSaveEmbeddings(state: DashboardCreationState, databaseId: number): Promise<DashboardCreationState> {
  const createdCards = [];
  const pageContents: string[] = [];
  const metadata: Record<string, any>[] = [];
  const pageIds: number[] = [];

  for (const cardDescription of state.cardDescriptions) {
    const cardObject = JSON.parse(cardDescription);
    const cardState = {
      ...state,
      task: cardObject.description,
      metabaseQuery: null,
      feedbackMessage: null,
      finalResult: '',
      queryAttempts: 0,
      cardId: 0,
      queryResult: null,
      fieldDetails: {},
      stopExecution: false,
    };

    const result = await createMetabaseCard(cardState, databaseId);

    if (result.cardId) {
      const queryResult = await executeQuery(state.sessionToken, result.cardId);

      if (!("error" in queryResult)) {
        createdCards.push({
          id: result.cardId,
          title: cardObject.title,
          description: cardObject.description,
          query: result.metabaseQuery,
          result: queryResult
        });

        pageContents.push(`${cardObject.title}\n${cardObject.description}`);
        metadata.push({
          id: result.cardId,
          type: 'card',
          databaseID: databaseId
        });
        pageIds.push(result.cardId);
      } else {
        Logger.error(`Error executing query for card ${cardObject.title}:`, queryResult.error);
      }
    } else {
      Logger.error(`Error creating card ${cardDescription}:`, result.feedbackMessage);
    }
  }

  // Save embeddings
  if (pageContents.length > 0) {
    try {
      await addDocuments(pageContents, metadata, pageIds);
      Logger.log('Embeddings saved successfully');
    } catch (error) {
      Logger.error('Error saving embeddings:', error);
    }
  }

  return {
    ...state,
    createdCards,
  };
}

async function createMetabaseDashboard(state: DashboardCreationState): Promise<DashboardCreationState> {
  const dashboardData = {
    name: state.task,
    description: `Dashboard for: ${state.task}`,
  };

  const cards = state.createdCards.map(card => ({
    card_id: card.id,
    col: 0,
    row: 0,
    sizeX: 2,
    sizeY: 2,
  }));

  const dashboardContent = {
    cards: cards,
  };

  try {
    const dashboardId = await createDashboard(state.sessionToken, dashboardData, dashboardContent);

    if (typeof dashboardId === 'number') {
      Logger.log('Dashboard created with ID:', dashboardId);

      return {
        ...state,
        dashboardId: dashboardId,
        finalDashboard: {
          id: dashboardId,
          cards: state.createdCards,
        }
      };
    } else {
      Logger.error('Error creating dashboard:', dashboardId.error);
      return state;
    }
  } catch (error) {
    Logger.error('Error during dashboard creation:', error);
    return state;
  }
}