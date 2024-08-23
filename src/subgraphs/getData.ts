import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, getFasterModel } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { fallbackCardExamples } from '../utils/CardExamples';
import { ToolDefinition } from '@langchain/core/language_models/base';
import { authenticate, createCard, deleteCard, executeQuery, fetchFieldDetails, getSchema, getExampleCards } from '../utils/MetabaseAPI';
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";
import type { Document } from "@langchain/core/documents";

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
});

const supabaseClient = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_PRIVATE_KEY as string
);

const vectorStore = new SupabaseVectorStore(embeddings, {
  client: supabaseClient,
  tableName: "documents",
  queryName: "match_documents",
});

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

async function fetchSchema(state: DataRecoveryState, database: number): Promise<DataRecoveryState> {
  const sessionToken = await authenticate();
  const schema = await getSchema(sessionToken, database);
  return {
    ...state,
    sessionToken,
    schema,
  };
}

async function evaluateFieldRequirements(state: DataRecoveryState): Promise<DataRecoveryState> {
  const identifyFields: ToolDefinition = {
    type: "function",
    function: {
      name: "identifyFields",
      description: "Identify fields in the schema that require additional details for the query.",
      parameters: {
        type: "object",
        properties: {
          fieldIds: {
            type: "array",
            description: "An array of IDs of the fields that require additional details.",
            items: {
              type: "integer",
              description: "The ID of a field."
            }
          },
        },
        required: ["fieldIds"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [identifyFields]);

  const message = await model.invoke([
    new HumanMessage(`Given the task: "${state.task}", identify which fields in the schema might need additional information such as distinct values or fingerprints to successfully complete the query. The schema is as follows: ${JSON.stringify(state.schema, null, 2)}`)
  ]);
  const requiredFieldIds: number[] = message.lc_kwargs.tool_calls[0].args.fieldIds;

  const fieldDetails: Record<number, any> = {};

  for (const fieldId of requiredFieldIds) {
    const details = await fetchFieldDetails(state.sessionToken, fieldId);
    if (details) {
      const limitedValues = details.values.slice(0, 20);
      if (limitedValues) {
        fieldDetails[fieldId] = {
          ...details,
          values: limitedValues,
        };
      }
    }
  }

  return {
    ...state,
    fieldDetails,
  };
}

// Node function to create Cube query
async function createMetabaseCard(
  state: DataRecoveryState,
  database: number
): Promise<DataRecoveryState> {
  const generateMetabaseQuery: ToolDefinition = {
    type: "function",
    function: {
      name: "generateMetabaseQuery",
      description: "Generate a Metabase query based on a natural language task and provided schema",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "A detailed description of the query's purpose.",
            minLength: 1
          },
          result_metadata: {
            type: "array",
            description: "Metadata about the results, including column descriptions, semantic types, and fingerprints.",
            items: {
              type: "object",
              properties: {
                description: { type: ["string", "null"] },
                semantic_type: { type: ["string", "null"] },
                converted_timezone: {
                  type: "string",
                  description: "Converted timezone for the field, IE: America/New_York, Europe/Amsterdam, etc.",
                  pattern: "(?:Z|(?:[+-]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,6})?)?))"
                },
                unit: { type: ["string", "null"] },
                name: { type: "string" },
                field_ref: { type: ["array", "null"]},
                id: { type: ["integer", "null"], minimum: 1 },
                display_name: { type: "string" },
                fingerprint: {
                  type: ["object", "null"],
                  properties: {
                    global: {
                      type: "object",
                      properties: {
                        "distinct-count": { type: "integer" },
                        "nil%": { type: ["number", "null"] }
                      }
                    },
                    type: {
                      type: "object",
                      properties: {
                        "type/Number": {
                          type: "object",
                          properties: {
                            min: { type: ["number", "null"] },
                            max: { type: ["number", "null"] },
                            avg: { type: ["number", "null"] },
                            q1: { type: ["number", "null"] },
                            q3: { type: ["number", "null"] },
                            sd: { type: ["number", "null"] }
                          }
                        },
                        "type/Text": {
                          type: "object",
                          properties: {
                            "percent-json": { type: ["number", "null"] },
                            "percent-url": { type: ["number", "null"] },
                            "percent-email": { type: ["number", "null"] },
                            "percent-state": { type: ["number", "null"] },
                            "average-length": { type: ["number", "null"] }
                          }
                        },
                        "type/DateTime": {
                          type: "object",
                          properties: {
                            earliest: { type: ["string", "null"] },
                            latest: { type: ["string", "null"] }
                          }
                        }
                      }
                    },
                  }
                },
                base_type: {
                  type: "string",
                  enum: ["type/Text", "type/Number", "type/Boolean", "type/DateTime", "type/URL", "type/Category"]
                }
              }
            }
          },
          collection_id: {
            type: "integer",
            description: "The ID of the collection where the card will be stored, for now pick 2 as is the default library folder", // TODO: Keep track of this in case we use multiple folders
            minimum: 1
          },
          name: {
            type: "string",
            description: "The name of the query or card.",
            minLength: 1
          },
          type: {
            type: "string",
            description: "The type of the card, either 'question', 'metric', or 'model'.",
            enum: ["question", "metric", "model"]
          },
          dataset_query: {
            type: "object",
            description: "The actual query to be executed, in structured JSON format.",
            properties: {
              database: { type: "integer", description: "The ID of the database to query." },
              type: { type: "string", enum: ["query"], description: "The type of the query." },
              query: { type: "object", description: "The query structure, including filters, aggregations, etc. Remember to use the CubeJoinField fields that all tables have to as source tables and identify the fields by their IDs" }
            },
            required: ["database", "type", "query"]
          },
          parameter_mappings: {
            type: "array",
            description: "Mappings for parameters used in the query.",
            items: {
              type: "object",
              properties: {
                parameter_id: { type: "string", minLength: 1 },
                target: { type: ["string", "object"] },
                card_id: { type: "integer", minimum: 1 }
              }
            }
          },
          display: {
            type: "string",
            description: "The display mode of the query, typically a visualization type.",
            minLength: 1
          },
          visualization_settings: {
            type: "object",
            description: "Settings for how the results will be visualized, in a chart or table.",
            properties: {
              graph: {
                type: "object",
                properties: {
                  dimensions: { type: "array", items: { type: "string" } },
                  metrics: { type: "array", items: { type: "string" } },
                  x_axis: {
                    type: "object",
                    properties: {
                      title_text: { type: "string" }
                    }
                  },
                  y_axis: {
                    type: "object",
                    properties: {
                      title_text: { type: "string" }
                    }
                  },
                  series_settings: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: {
                        display: { type: "string", enum: ["line", "bar", "area"] },
                        color: { type: "string" }
                      }
                    }
                  }
                }
              },
              table: {
                type: "object",
                properties: {
                  pivot: { type: "boolean" },
                  column_formatting: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        color: { type: "string" },
                        columns: { type: "array", items: { type: "string" } },
                        highlight_row: { type: "boolean" },
                        operator: { type: "string" },
                        value: { type: "number" }
                      }
                    }
                  }
                }
              },
              pie: {
                type: "object",
                properties: {
                  colors: {
                    type: "object",
                    additionalProperties: { type: "string" }
                  }
                }
              },
              pivot_table: {
                type: "object",
                properties: {
                  column_split: {
                    type: "object",
                    properties: {
                      columns: { type: "array", items: { type: "string" } },
                      rows: { type: "array", items: { type: "string" } },
                      values: { type: "array", items: { type: "string" } }
                    }
                  },
                  column_widths: {
                    type: "object",
                    properties: {
                      leftHeaderWidths: { type: "array", items: { type: "number" } },
                      totalLeftHeaderWidths: { type: "number" },
                      valueHeaderWidths: { type: "object" }
                    }
                  }
                }
              }
            }
          },
          parameters: {
            type: "array",
            description: "Parameters that can be passed into the query for dynamic filtering.",
            items: {
              type: "object",
              properties: {
                slug: { type: "string" },
                default: { type: ["string", "number", "boolean", "null"] },
                name: { type: "string" },
                type: {
                  type: "string",
                  description: "The type of parameter, such as 'string', 'number', 'date', etc.",
                  minLength: 1
                },
                temporal_units: {
                  type: "array",
                  items: { type: "string", enum: ["quarter", "day", "hour", "week", "second", "month", "year"] }
                },
                sectionId: { type: "string", minLength: 1 },
                values_source_type: {
                  type: "string",
                  enum: ["static-list", "card", "null"]
                },
                id: { type: "string", minLength: 1 },
                values_source_config: {
                  type: "object",
                  properties: {
                    values: { type: ["array", "null"], items: { type: ["string", "number", "boolean"] } },
                    card_id: { type: ["integer", "null"], minimum: 1 },
                    value_field: {
                      type: ["array", "null"],
                      items: {
                        type: "object",
                        properties: {
                          field_id: { type: ["string", "integer"] },
                          options: { type: "object" }
                        }
                      }
                    },
                    label_field: {
                      type: ["array", "null"],
                      items: {
                        type: "object",
                        properties: {
                          field_id: { type: ["string", "integer"] },
                          options: { type: "object" }
                        }
                      }
                    }
                  }
                }
              },
              required: ["id", "type"]
            }
          }
        },
        required: ["name", "dataset_query", "display", "type", "visualization_settings"]
      }
    }
  };

  const filter = { databaseID: database };

  Logger.log('Finding similar cards for:', state.task);

  const similaritySearchWithScoreResults = await vectorStore.similaritySearchWithScore(state.task, 1, filter);

  let ids = [];

  for (const [doc, score] of similaritySearchWithScoreResults) {
    Logger.log(
      `* [SIM=${score.toFixed(3)}] ${doc.pageContent} [${JSON.stringify(
        doc.metadata
      )}]`
    );
    ids.push(doc.metadata.id);
  }
  
  const exampleRelatedCards = await getExampleCards(state.sessionToken, ids);

  console.log('exampleRelatedCards', exampleRelatedCards);
  
  const model = createStructuredResponseAgent(anthropicSonnet(), [generateMetabaseQuery]); // Only model flexible enough to generate the query

  const queryAttempts =  (state.queryAttempts || 0) + 1;
  if (queryAttempts > 3) {
    Logger.log("Unable to generate a suitable query after 3 attempts.")
    return {
      ...state,
      queryAttempts, 
      finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + state.feedbackMessage
    }
  }

  const message = await model.invoke([ // TODO: Move toolDefinition and prompt with more examples to a separate file, we should also make it way shorter giving examples of how to build queries instead of full queries
    new HumanMessage(`You are tasked with generating a Metabase query based on the following natural language task: 
    "${state.task}"

    The query must be interpretable by a business analyst, you should strive to make them easy to interpret and good looking.
  
    The schema of the database is:
    ${JSON.stringify(state.schema, null, 2)}
    You can only use the tables and fields that are provided in the schema.

    Here are some value examples for some of the fields of the schema:
    ${state.fieldDetails}
  
    Ensure that the query is well-formed, syntactically correct, and meets the requirements of the task.
    When applying filters, try to apply is not empty filters and prioritize contains filters over equals filters.
  
    ${state.feedbackMessage ? `Previous attempt has generated the following query ${state.metabaseQuery}, and resulted in an error: ${state.feedbackMessage}\n Please adjust the query or try a different approach to avoid this error` : ''}

    Try to leverage the "CubeJoinField" fields that all tables have to as source tables 
           
    Here are some examples of a natural language query and its corresponding JSON representation (which used other tables you may not be able to use):

    ${state.feedbackMessage ? fallbackCardExamples : exampleRelatedCards}
  
    `)
  ]);
  
  const metabaseQuery = message.lc_kwargs.tool_calls[0].args;

  const cardIdResponse = await createCard(state.sessionToken, metabaseQuery); 

  let feedbackMessage = '';
  if (typeof cardIdResponse === 'object' && ('error' in cardIdResponse)) {
    if (JSON.parse(cardIdResponse.error).message) {
      Logger.error(`Failed to create card: ${JSON.parse(cardIdResponse.error).message} (Status: ${cardIdResponse.status})`);
      feedbackMessage = JSON.parse(cardIdResponse.error).message;
    } else {
      Logger.error(`Failed to create card: ${JSON.stringify(cardIdResponse.error, null, 2)} (Status: ${cardIdResponse.status})`);
      feedbackMessage = "unknown error, try to create the query in a different way";
    }
    return {
      ...state,
      queryAttempts,
      feedbackMessage: feedbackMessage,
      metabaseQuery: JSON.stringify(metabaseQuery)
    };
  } else {
    Logger.log('Card ID:', cardIdResponse); 
    return {
      ...state,
      queryAttempts,
      cardId: cardIdResponse,
      metabaseQuery: JSON.stringify(metabaseQuery)
    };
  }

  
}

async function executeMetabaseQuery(state: DataRecoveryState): Promise<DataRecoveryState> {
  let cardId = state.cardId;
  const query = JSON.parse(state.metabaseQuery);
  const queryResult = await executeQuery(state.sessionToken, state.cardId);
  let feedbackMessage = queryResult.error ?? "";
  if (("error" in queryResult)) {
    Logger.log("Error executing query. Deleting card...")
    await deleteCard(state.sessionToken, state.cardId);
    cardId = 0;
  }

  if (queryResult.error && queryResult.error.includes("Can't detect Cube query")) {
    Logger.error("We tried to execute a SQL query not supported by cubejs")
    feedbackMessage = "The SQL created from your query is not supported by cubejs, please try to create the query in a different way";
  }

  let stopExecution = false;
  let errorResult;
  if (queryResult.error && queryResult.error.includes("Can't find join path")) {
    Logger.error("There is no JOIN between the sources ")
    stopExecution = true;
    errorResult = "Is not possible to create a card with the requested info because the relevant sources don't have a proper JOIN. Please define the schema and create the JOINS in order to get this data.";
  }

  Logger.log('Creating document:');

  const document: Document = {
    pageContent: query.description,
    metadata: { id:cardId, databaseID: query.dataset_query.database},
  };
/*
  Logger.log('Adding document to vector store:', [document], { ids: [cardId] });
  
  const test = await vectorStore.addDocuments([document], { ids: [cardId] });

  Logger.log('Added document to vector store:', test);

  Logger.log('CHANGE THIS ONCE WE HAVE THE FRONT STORE THEM');
*/
  return {
    ...state,
    feedbackMessage: feedbackMessage,
    queryResult,
    cardId, 
    stopExecution,
    finalResult: errorResult ? errorResult : JSON.stringify(queryResult, null, 2),
  };
}

async function getReasoning(state: DataRecoveryState, functions: Function[]): Promise<DataRecoveryState> {
  const getReasoning: ToolDefinition = {  
    type: "function",
    function: {
      name: "getReasoning",
      description: "Explains the reasoning behind how the card was created",
      parameters: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description: "Reasoning behind how the card was created"
          },
          sources: {
            type: "object",
            description: "An object containing the tables and fields used to create the card",
            properties: {
              tables: {
                type: "array",
                description: "Array of objects representing tables and their corresponding fields",
                items: {
                  type: "object",
                  properties: {
                    tableName: {
                      type: "string",
                      description: "Name of the table"
                    },
                    fields: {
                      type: "array",
                      description: "Fields used in this table",
                      items: {
                        type: "string",
                        description: "Name of the field"
                      }
                    }
                  },
                  required: ["tableName", "fields"]
                }
              }
            },
            required: ["tables"]
          }
        },
        required: ["reasoning", "sources"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [getReasoning]); 

  let resultString = '';

  if (typeof state.queryResult === 'object') {
    resultString = JSON.stringify(state.queryResult);
  }

  let message;
  if (state.queryResult.length === 0) {
    Logger.log('No results!');
    resultString = "The query has not returned values";
    message = await model.invoke([
      new HumanMessage(`You were asked to perform this task: ${state.task}
    
        This is the query created for the card: ${state.metabaseQuery.dataset_query ? (state.metabaseQuery.dataset_query.query ?? state.metabaseQuery.dataset_query) : state.metabaseQuery}, 
        
        This query does not return values. 
        
        The details of the relevant fields are: ${JSON.stringify(state.fieldDetails)}

        Analyze details of the relevant fields to explain why there is no data. 
        Reference the contents of those fields. 
        
        IE: There are no results because the field 'Date' has data ranging from 2024-01-11 to 2024-08-13. 

        The current date is ${new Date()}
      `),
    ]);
  } else {
    if (resultString.length > 5000) {
      resultString = resultString.substring(0, 5000) + '... (truncated to 5000 characters)';
    }

    Logger.log('Query result:', resultString);

    message = await model.invoke([
      new HumanMessage(`You were asked to perform this task: ${state.task}
    
        This is the query created for the card: ${state.metabaseQuery.dataset_query ? (state.metabaseQuery.dataset_query.query ?? state.metabaseQuery.dataset_query) : state.metabaseQuery}, 
        due the following database schema: ${state.schema} 
        
        The results of execution of the card are: ${resultString})()
        }
        
        Explain how the task has been performed and give a reasoning on the fields and tables that have been used. The sources should be provided as an object where each table is represented with its name, and each table contains an array of the fields used. Note that the query result has been truncated to 5000 characters if it exceeded that length.`),
    ]);
  }

  const args = message.lc_kwargs.tool_calls[0].args;

  const reasoning = args.reasoning;
  const sources = args.sources;

  const getDatasetQuery = [
    {
      function_name: 'getDatasetQuery',
      arguments: {
        cardId: state.cardId,
        reasoning,
        sources
      }
    },
  ];
  functions[0]('tool', getDatasetQuery);
 
  return {
    ...state,
    finalResult: resultString // we reassign here the truncated result
  };
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
