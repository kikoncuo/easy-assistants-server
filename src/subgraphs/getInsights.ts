import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, getFasterModel, getStrongestModel, groqChatLlama } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { ToolDefinition } from '@langchain/core/language_models/base';
import { authenticate, getCards, getSchema, getCard, createCard, executeQuery } from '../utils/MetabaseAPI';

interface InsightState extends BaseState {
  sessionToken: string;
  schema: any[];
  relevantCards: any[]; 
  responses: string[];
  finalResult: string;
}

async function fetchSchema(state: InsightState, database: number): Promise<InsightState> {
  const sessionToken = await authenticate();
  const schema = await getSchema(sessionToken, database);
  return {
    ...state,
    sessionToken,
    schema,
  };
}

// Node function to recover sources
async function identifyRelevantSources(state: InsightState, dbId: number): Promise<InsightState> {

  const cards = await getCards(state.sessionToken, dbId);

  const getRelevantCards: ToolDefinition = {
    type: "function",
    function: {
      name: "getRelevantCards",
      description: "Identify relevant cards for a given request",
      parameters: {
        type: "object",
        properties: {
          relevantCards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number" }
              },
              required: ["id"]
            },
            description: "Array with the IDs of the relevant cards"
          }
        },
        required: ["relevantCards"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [getRelevantCards]);

  const message = await model.invoke([
    new HumanMessage(`
      Your task is to identify 3 or 4 relevant cards that could help resolve a given request. 
      To do this, you need to analyze the names, descriptions, and dataset queries of the available cards.
  
      The available cards are: ${JSON.stringify(cards)}
      The schema related to the dataset queries is: ${JSON.stringify(state.schema)}
  
      The request you need to consider is: ${state.task}
  
      Please analyze the dataset queries and schema to determine how the data is retrieved by each card and assess if it is relevant to the request.
    `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const relevantCardsIds = args.relevantCards;

  const relevantCards = relevantCardsIds.map((relevantCard: { id: number; }) => {
    const card = cards[relevantCard.id];
    return card ? { id: relevantCard.id, ...card } : null;
  }).filter((card: any) => card !== null);

  Logger.log('\rrelevantCards', relevantCards);

  if (relevantCards.length > 0) {
    return {
      ...state,
      relevantCards: relevantCards,
    };
  } else {
    Logger.log("No relevant cards found to create the insights")
    return {
      ...state,
      finalResult: "No relevant cards found to create the insights", // This will be solved in V2 creating another node to create new cards.
    };
  }
  }

  


async function addFilters(state: InsightState, databaseId: number): Promise<InsightState> {
  const analyzeFilters: ToolDefinition = {
    type: "function",
    function: {
      name: "analyzeFilters",
      description: "Analyze relevant cards to determine if they need filters and suggest modifications",
      parameters: {
        type: "object",
        properties: {
          cardModifications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number" },
                needsFilter: { type: "boolean" },
                modifiedDatasetQuery: { type: "object" },
                newTitle: { type: "string" },
                newDescription: { type: "string" }
              },
              required: ["id", "needsFilter"]
            },
            description: "Array with the relevatn cards modified if needed"
          }
        },
        required: ["cardModifications"]
      }
    }
  };

  const model = createStructuredResponseAgent(anthropicSonnet(), [analyzeFilters]);

  const message = await model.invoke([
    new HumanMessage(`
      You need to analyze the relevant cards to determine if they require filters to better meet the user's needs.
      The user's request is: ${state.task}
      
      Based on this request, analyze each relevant card to determine if it needs additional filters. 
      If filters are needed, suggest modifications to the dataset query, a new title, and a new description.

      The relevant cards are: ${JSON.stringify(state.relevantCards)}
      The schema related to the dataset queries is: ${JSON.stringify(state.schema)}
  
      Please analyze each card and suggest appropriate modifications if filters are necessary. 
      Ensure that the modifications align with the user's request, and provide a new title and description that reflect the changes made to the card.

      If no modifications are needed just return the id of the card and the value needsFilter = false

      Try to use only basic filters.
      This is an example of dataset_query using filters:

      {
        "database": ${databaseId},
        "type": "query",
        "query": {
          "source-table": 142,
          "aggregation": [
            [
              "sum",
              [
                "field",
                2024,
                {
                  "base-type": "type/Decimal"
                }
              ]
            ]
          ],
          "breakout": [
            [
              "field",
              2097,
              {
                "base-type": "type/Text",
                "join-alias": "Location - CubeJoinField"
              }
            ],
            [
              "field",
              2027,
              {
                "base-type": "type/DateTime",
                "temporal-unit": "month"
              }
            ]
          ],
          "joins": [
            {
              "fields": "all",
              "strategy": "left-join",
              "alias": "Location - CubeJoinField",
              "condition": [
                "=",
                [
                  "field",
                  2038,
                  {
                    "base-type": "type/Text"
                  }
                ],
                [
                  "field",
                  2099,
                  {
                    "base-type": "type/Text",
                    "join-alias": "Location - CubeJoinField"
                  }
                ]
              ],
              "source-table": 148
            }
          ],
          "order-by": [
            [
              "asc",
              [
                "aggregation",
                0
              ]
            ]
          ],
          "filter": [
            "and",
            [
              "not-empty",
              [
                "field",
                2097,
                {
                  "base-type": "type/Text",
                  "join-alias": "Location - CubeJoinField"
                }
              ]
            ],
            [
              "time-interval",
              [
                "field",
                2027,
                {
                  "base-type": "type/DateTime"
                }
              ],
              -12,
              "month"
            ]
          ]
        }
      }
    `),
  ]);
  

  const args = message.lc_kwargs.tool_calls[0].args;

  const cardModifications = args.cardModifications;
  Logger.log('\rCard Modifications', cardModifications);

  const updatedCards = [];

  for (const modifiedCard of cardModifications) {
    if (modifiedCard.needsFilter) {
      const cardDetails = await getCard(state.sessionToken, modifiedCard.id);

      const newCard = await createCard(state.sessionToken, {
        ...cardDetails,
        name: modifiedCard.newTitle,
        description: modifiedCard.newDescription,
        dataset_query: modifiedCard.modifiedDatasetQuery,
      });

      Logger.log("Card created:", newCard)

      updatedCards.push(newCard);
    } else {
      updatedCards.push(modifiedCard.id);
    }
  }

  return {
    ...state,
    relevantCards: updatedCards,
  };
}

async function getResults(state: InsightState, functions: Function[]): Promise<InsightState> {
  const insights = [];
   const generateInsight: ToolDefinition = {
    type: "function",
    function: {
      name: "generateInsight",
      description: "Generate an insight explanation based on the query result",
      parameters: {
        type: "object",
        properties: {
          cardId: { type: "number" },
          insightExplanation: { type: "string" }
        },
        required: ["cardId", "insightExplanation"]
      }
    }
  };
  Logger.log("Relevant cards", state.relevantCards)
  for (const card of state.relevantCards) {
    const queryResult = await executeQuery(state.sessionToken, card);

    if (queryResult.error) {
      Logger.warn(`Error executing query for card ${card}: ${queryResult.error}`);
      continue;
    }

    const model = createStructuredResponseAgent(getFasterModel(), [generateInsight]);

    let resultString = JSON.stringify(queryResult);
    if (resultString.length > 5000) {
      resultString = resultString.substring(0, 5000) + '... (truncated to 5000 characters)';
    }

    const message = await model.invoke([
      new HumanMessage(`
        You have just executed a query for the card with ID ${card}. 
        The user's request was: ${state.task}

        The query result is: ${resultString}

        Based on this result, provide a concise explanation of the insight this data provides. 
        Your explanation should be informative and relevant to the user's request.
      `),
    ]);

    const args = message.lc_kwargs.tool_calls[0].args;

    insights.push({
      cardId: card,
      insightExplanation: args.insightExplanation,
    });
  }

  const getInsights = [
    {
      function_name: 'getInsights',
      arguments: {
        insights: insights
      }
    },
  ];
  functions[0]('tool', getInsights);
 
  return {
    ...state,
    finalResult: JSON.stringify(insights),
  };
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

  getGraph(): CompiledStateGraph<InsightState> {
    const subGraphBuilder = new StateGraph<InsightState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetchSchema', async state => await fetchSchema(state, this.databaseId))
      .addNode('identify_sources', async state => await identifyRelevantSources(state, this.databaseId))
      .addNode('add_filters', async state => await addFilters(state, this.databaseId))
      .addNode('get_results', async state => await getResults(state, this.functions))
      .addEdge(START, 'fetchSchema')
      .addEdge('fetchSchema', 'identify_sources')
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
