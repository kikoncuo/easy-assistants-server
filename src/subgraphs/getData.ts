import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, getFasterModel } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { ToolDefinition } from '@langchain/core/language_models/base';
import { authenticate, createCard, deleteCard, executeQuery, fetchFieldDetails, getSchema } from '../utils/MetabaseAPI';

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
                field_ref: { type: ["array", "null"], items: { type: ["string", "integer"] } },
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
              query: { type: "object", description: "The query structure, including filters, aggregations, etc." }
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
  
  
  const model = createStructuredResponseAgent(anthropicSonnet(), [generateMetabaseQuery]); // Only model flexible enough to generate the query

  const queryAttempts =  (state.queryAttempts || 0) + 1;
  if (queryAttempts > 3) {
    Logger.log("Unable to generate a suitable query after 3 attempts.")
    return {
      ...state,
      queryAttempts, 
      finalResult: "Unable to generate a suitable query after 3 attempts."
    }
  }

  const message = await model.invoke([ // TODO: Move toolDefinition and prompt with more examples to a separate file, we should also make it way shorter giving examples of how to build queries instead of full queries
    new HumanMessage(`You are tasked with generating a Metabase query based on the following natural language task: 
    "${state.task}"

    The query must be interpretable by a business analyst, you should avoid using IDs and you should strive to make them easy to interpret and good looking.
  
    The schema of the database is:
    ${JSON.stringify(state.schema, null, 2)}

    Here are some value examples for some of the fields of the schema:
    ${state.fieldDetails}
  
    Ensure that the query is well-formed, syntactically correct, and meets the requirements of the task.
  
    ${state.feedbackMessage ? `Previous attempt has generated the following query ${state.metabaseQuery}, and resulted in an error: ${state.feedbackMessage}\n Please adjust the query or try a different approach to avoid this error` : ''}

           
    Here are some examples of a natural language query and its corresponding JSON representation:
  
    **Example 1:**

    **Natural Language Query:**
    "Show me the cumulative revenue and the number of orders placed each month for the last 24 months. The revenue should be plotted as a line graph, and the number of orders should be plotted on the same graph with a different color."
  
    **JSON Representation:**
    {
      "description": "Matches the cumulative revenue month over month with the number of orders placed each month",
      "collection_position": 1,
      "result_metadata": [
        {
          "description": "The date and time an order was submitted.",
          "semantic_type": "type/CreationTimestamp",
          "unit": "month",
          "name": "CREATED_AT",
          "field_ref": [
            "field",
            41,
            {
              "base-type": "type/DateTime",
              "temporal-unit": "month"
            }
          ],
          "effective_type": "type/DateTime",
          "id": 41,
          "display_name": "Created At",
          "fingerprint": {
            "global": {
              "distinct-count": 10001,
              "nil%": 0
            },
            "type": {
              "type/DateTime": {
                "earliest": "2022-04-30T18:56:13.352Z",
                "latest": "2026-04-19T14:07:15.657Z"
              }
            }
          },
          "base_type": "type/DateTime"
        },
        {
          "display_name": "Sum of Total",
          "field_ref": [
            "aggregation",
            0
          ],
          "base_type": "type/Float",
          "effective_type": "type/Float",
          "name": "sum",
          "fingerprint": {
            "global": {
              "distinct-count": 24,
              "nil%": 0
            },
            "type": {
              "type/Number": {
                "min": 4960.6397462410805,
                "q1": 11169.135645794311,
                "q3": 35724.252952714145,
                "max": 45506.820164951256,
                "sd": 13137.991436252625,
                "avg": 21649.1095952852
              }
            }
          }
        },
        {
          "display_name": "Sum of Quantity",
          "semantic_type": "type/Quantity",
          "field_ref": [
            "aggregation",
            1
          ],
          "base_type": "type/BigInteger",
          "effective_type": "type/BigInteger",
          "name": "sum_2",
          "fingerprint": {
            "global": {
              "distinct-count": 24,
              "nil%": 0
            },
            "type": {
              "type/Number": {
                "min": 292,
                "q1": 491,
                "q3": 1743,
                "max": 2803,
                "sd": 791.9851216853853,
                "avg": 1170.4583333333333
              }
            }
          }
        }
      ],
      "collection_id": 2,
      "name": "Revenue and orders over time",
      "type": "question",
      "dataset_query": {
        "database": ${database},
        "type": "query",
        "query": {
          "aggregation": [
            [
              "sum",
              [
                "field",
                42,
                {
                  "base-type": "type/Float"
                }
              ]
            ],
            [
              "sum",
              [
                "field",
                39,
                {
                  "base-type": "type/Integer"
                }
              ]
            ]
          ],
          "breakout": [
            [
              "field",
              41,
              {
                "base-type": "type/DateTime",
                "temporal-unit": "month"
              }
            ]
          ],
          "source-table": 5,
          "filter": [
            "time-interval",
            [
              "field",
              41,
              {
                "base-type": "type/DateTime"
              }
            ],
            -24,
            "month"
          ]
        }
      },
      "display": "combo",
      "visualization_settings": {
        "graph.dimensions": [
          "CREATED_AT"
        ],
        "graph.show_trendline": false,
        "graph.x_axis.title_text": "Orders date",
        "graph.y_axis.title_text": "Revenue",
        "series_settings": {
          "sum": {
            "display": "line",
            "line.interpolate": "linear",
            "line.marker_enabled": false,
            "show_series_values": true,
            "title": "Revenue"
          },
          "sum_2": {
            "color": "#51528D",
            "title": "Number of orders"
          }
        },
        "graph.metrics": [
          "sum",
          "sum_2"
        ]
      },
      "parameters": []
    }
    
    **Example 2:**

    **Natural Language Query:**
    "Show me the most successful products, excluding the 'Incredible Aluminum Knife', and order them by the number of orders placed, from highest to lowest, make units a suffix and set a goal line of 150 units."
    
    **JSON Representation:**
    {
      "description": "An ordered list of our most successful products",
      "collection_position": 1,
      "result_metadata": [
        {
          "description": "The name of the product as it should be displayed to customers.",
          "semantic_type": "type/Title",
          "name": "TITLE",
          "field_ref": [
            "field",
            65,
            {
              "base-type": "type/Text",
              "source-field": 40
            }
          ],
          "effective_type": "type/Text",
          "id": 65,
          "display_name": "Product → Title",
          "fingerprint": {
            "global": {
              "distinct-count": 199,
              "nil%": 0
            },
            "type": {
              "type/Text": {
                "percent-json": 0,
                "percent-url": 0,
                "percent-email": 0,
                "percent-state": 0,
                "average-length": 21.495
              }
            }
          },
          "base_type": "type/Text"
        },
        {
          "description": "The type of product, valid values include: Doohicky, Gadget, Gizmo and Widget",
          "semantic_type": "type/Category",
          "name": "CATEGORY",
          "field_ref": [
            "field",
            58,
            {
              "base-type": "type/Text",
              "source-field": 40
            }
          ],
          "effective_type": "type/Text",
          "id": 58,
          "display_name": "Product → Category",
          "fingerprint": {
            "global": {
              "distinct-count": 4,
              "nil%": 0
            },
            "type": {
              "type/Text": {
                "percent-json": 0,
                "percent-url": 0,
                "percent-email": 0,
                "percent-state": 0,
                "average-length": 6.375
              }
            }
          },
          "base_type": "type/Text"
        },
        {
          "display_name": "Count",
          "semantic_type": "type/Quantity",
          "field_ref": [
            "field",
            "count",
            {
              "base-type": "type/Integer"
            }
          ],
          "name": "count",
          "base_type": "type/BigInteger",
          "effective_type": "type/BigInteger",
          "fingerprint": {
            "global": {
              "distinct-count": 8,
              "nil%": 0
            },
            "type": {
              "type/Number": {
                "min": 109,
                "q1": 109.36150801752578,
                "q3": 117.41886116991581,
                "max": 120,
                "sd": 4.254710813035841,
                "avg": 113.53846153846153
              }
            }
          }
        }
      ],
      "collection_id": 2,
      "name": "Best selling products",
      "type": "question",
      "dataset_query": {
        "database":  ${database},
        "type": "query",
        "query": {
          "filter": [
            ">",
            [
              "field",
              "count",
              {
                "base-type": "type/Integer"
              }
            ],
            108
          ],
          "source-query": {
            "aggregation": [
              [
                "count"
              ]
            ],
            "breakout": [
              [
                "field",
                65,
                {
                  "base-type": "type/Text",
                  "source-field": 40
                }
              ],
              [
                "field",
                58,
                {
                  "base-type": "type/Text",
                  "source-field": 40
                }
              ]
            ],
            "order-by": [
              [
                "desc",
                [
                  "aggregation",
                  0
                ]
              ]
            ],
            "source-table": 5,
            "filter": [
              "!=",
              [
                "field",
                65,
                {
                  "base-type": "type/Text",
                  "source-field": 40
                }
              ],
              "Incredible Aluminum Knife"
            ]
          }
        }
      },
      "display": "row",
      "visualization_settings": {
        "graph.show_goal": true,
        "graph.y_axis.title_text": "total orders",
        "graph.show_values": true,
        "table.pivot": false,
        "graph.x_axis.title_text": "Products",
        "graph.goal_value": 150,
        "graph.metrics": [
          "count"
        ],
        "graph.label_value_formatting": "compact",
        "column_settings": {
          "[\"name\",\"count\"]": {
            "suffix": "  units"
          }
        },
        "series_settings": {
          "count": {
            "color": "#999AC4"
          }
        },
        "graph.dimensions": [
          "TITLE"
        ],
        "stackable.stack_type": null
      },
      "parameters": []
    }
    
    **Example 3:**

    **Natural Language Query:**
    "Show me the the total orders placed each quarter, broken down by the source of the order. The table should highlight the best and worst quarters."
  
    **JSON Representation:**
    {
      "description": "Orders placed per quarter broken down by source and formatted to highlight best and worst quarters",
      "collection_position": 1,
      "result_metadata": [
        {
          "description": "The channel through which we acquired this user. Valid values include: Affiliate, Facebook, Google, Organic and Twitter",
          "semantic_type": null,
          "name": "SOURCE",
          "field_ref": [
            "expression",
            "pivot-grouping"
          ],
          "effective_type": "type/Text",
          "id": 45,
          "display_name": "pivot-grouping",
          "fingerprint": {
            "global": {
              "distinct-count": 1,
              "nil%": 0
            },
            "type": {
              "type/Number": {
                "min": 3,
                "q1": 3,
                "q3": 3,
                "max": 3,
                "sd": null,
                "avg": 3
              }
            }
          },
          "base_type": "type/Integer"
        },
        {
          "description": "The date and time an order was submitted.",
          "semantic_type": null,
          "name": "CREATED_AT",
          "field_ref": [
            "aggregation",
            0
          ],
          "effective_type": "type/DateTime",
          "id": 41,
          "display_name": "Sum of Subtotal",
          "fingerprint": {
            "global": {
              "distinct-count": 1,
              "nil%": 0
            },
            "type": {
              "type/Number": {
                "min": 498467.3866983962,
                "q1": 498467.3866983962,
                "q3": 498467.3866983962,
                "max": 498467.3866983962,
                "sd": null,
                "avg": 498467.3866983962
              }
            }
          },
          "base_type": "type/Float"
        }
      ],
      "collection_id": 2,
      "name": "Orders according to sources per quarter",
      "type": "question",
      "dataset_query": {
        "database":  ${database},
        "type": "query",
        "query": {
          "aggregation": [
            [
              "sum",
              [
                "field",
                44,
                {
                  "base-type": "type/Float"
                }
              ]
            ]
          ],
          "breakout": [
            [
              "field",
              45,
              {
                "base-type": "type/Text",
                "source-field": 43
              }
            ],
            [
              "field",
              41,
              {
                "base-type": "type/DateTime",
                "temporal-unit": "quarter"
              }
            ]
          ],
          "source-table": 5,
          "filter": [
            "time-interval",
            [
              "field",
              41,
              {
                "base-type": "type/DateTime"
              }
            ],
            -24,
            "month"
          ]
        }
      },
      "display": "pivot",
      "visualization_settings": {
        "graph.dimensions": [
          "CREATED_AT",
          "SOURCE"
        ],
        "graph.series_labels": [
          null
        ],
        "pivot_table.column_split": {
          "columns": [
            [
              "field",
              45,
              {
                "base-type": "type/Text",
                "source-field": 43
              }
            ]
          ],
          "rows": [
            [
              "field",
              41,
              {
                "base-type": "type/DateTime",
                "temporal-unit": "quarter"
              }
            ]
          ],
          "values": [
            [
              "aggregation",
              0
            ]
          ]
        },
        "pivot_table.column_widths": {
          "leftHeaderWidths": [
            141
          ],
          "totalLeftHeaderWidths": 141,
          "valueHeaderWidths": {}
        },
        "stackable.stack_type": "stacked",
        "table.column_formatting": [
          {
            "max_value": 100,
            "color": "#509EE3",
            "columns": [
              "sum"
            ],
            "value": "",
            "type": "range",
            "colors": [
              "#ED6E6E",
              "#FFFFFF",
              "#84BB4C"
            ],
            "highlight_row": false,
            "min_value": 0,
            "min_type": null,
            "id": 0,
            "operator": "=",
            "max_type": null
          }
        ],
        "graph.metrics": [
          "sum"
        ]
      },
      "parameters": []
    }
    
    
    `)
  ]);
  
  const metabaseQuery = message.lc_kwargs.tool_calls[0].args;

  const cardIdResponse = await createCard(state.sessionToken, metabaseQuery); 
  Logger.log('Card ID:', cardIdResponse); 


  if (typeof cardIdResponse === 'object' && ('error' in cardIdResponse)) {
    Logger.error(`Failed to create card: ${JSON.parse(cardIdResponse.error).message} (Status: ${cardIdResponse.status})`); 
    return {
      ...state,
      queryAttempts,
      feedbackMessage: JSON.parse(cardIdResponse.error).message,
      metabaseQuery: JSON.stringify(metabaseQuery)
    };
  } else {
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
  const queryResult = await executeQuery(state.sessionToken, state.cardId);
  if (("error" in queryResult)) {
    Logger.log("Error executing query. Deleting card...")
    await deleteCard(state.sessionToken, state.cardId);
    cardId = 0;
  }

  return {
    ...state,
    feedbackMessage: queryResult.error ?? "", 
    queryResult,
    cardId, 
    finalResult: JSON.stringify(queryResult, null, 2),
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

  const message = await model.invoke([
    new HumanMessage(`You were asked to perform this task: ${state.task}

      This is the query created for the card: ${state.metabaseQuery.dataset_query ? (state.metabaseQuery.dataset_query.query ?? state.metabaseQuery.dataset_query) : state.metabaseQuery}, 
      due the following database schema: ${state.schema} 
      
      The first 20 results of execution of the card are: ${JSON.stringify(state.queryResult.slice(0, 20))} 

      Explain how the task has been performed and give a reasoning on the fields and tables that have been used. The sources should be provided as an object where each table is represented with its name, and each table contains an array of the fields used.`),
  ]);

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
    ...state
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
      fieldDetails: {   // Añadir esta línea para incluir el nuevo estado
        value: (x: Record<number, any>, y?: Record<number, any>) => (y ? y : x),
        default: () => ({}),
      },
    };
    super(graphState);
    this.functions = functions;
    this.database = database;
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', async state => await fetchSchema(state, this.database))
      .addNode('evaluate_fields', async state => await evaluateFieldRequirements(state)) 
      .addNode('create_card', async (state) => await createMetabaseCard(state, this.database))
      .addNode('execute_query', async state => await executeMetabaseQuery(state))
      .addNode('getReasoning', async state => await getReasoning(state, this.functions))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'evaluate_fields') 
      .addEdge('evaluate_fields', 'create_card')
      .addConditionalEdges('create_card', (state) => {
        if (state.queryAttempts > 3) {
          return END;
        } else if (!state.cardId) {
          return 'create_card';
        } else {
          return 'execute_query';
        }
      })
      .addConditionalEdges('execute_query', (state) => {
        if (state.queryAttempts > 3) {
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
