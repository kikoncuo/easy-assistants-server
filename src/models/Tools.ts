import { ToolDefinition } from '@langchain/core/language_models/base';

// Tool Definitions
export const IdentifySourcesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "identifySources",
    description: "Identify relevant sources in the schema for creating a dashboard.",
    parameters: {
      type: "object",
      properties: {
        relevantSources: {
          type: "array",
          description: "An array of relevant source tables and their fields.",
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
        },
      },
      required: ["relevantSources"]
    }
  }
};

export const IdentifyFieldsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "identifyFields",
    description: "Identify fields in the schema that require additional details for the query and determine the difficulty of calculating the necessary values with the current fields.",
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
        isPossible: {
          type: "string",
          description: `A string indicating the difficulty of calculating the necessary values with the current fields in the schema. It can be:
                        - "yes" if the calculation is straightforward.
                        - "maybe" if the calculation is possible but may complicate the query.
                        - "no" if it is not possible.`,
          enum: ["yes", "maybe", "no"]
        },
      },
      required: ["fieldIds", "isPossible"]
    }
  }
};

export const GetReasoningTool: ToolDefinition = {
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

export const AnalyzeFiltersTool: ToolDefinition = {
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
          description: "Array with the relevant cards modified if needed"
        }
      },
      required: ["cardModifications"]
    }
  }
};

export const GenerateInsightTool: ToolDefinition = {
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

export const GenerateMetabaseQueryTool: ToolDefinition = {
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

export const GenerateCardDescriptionsTool: ToolDefinition = {
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

export const GenerateDashboardLayoutTool: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_dashboard_layout",
    description: "Generates a dashboard layout based on the given cards and task",
    parameters: {
      type: "object",
      properties: {
        dashboardLayout: {
          type: "object",
          description: "The dashboard layout configuration",
          properties: {
            description: { type: "string" },
            name: { type: "string" },
            dashcards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "number" },
                  card_id: { type: "number" },
                  row: { type: "number" },
                  col: { type: "number" },
                  size_x: { type: "number" },
                  size_y: { type: "number" },
                  parameter_mappings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        parameter_id: { type: "string" },
                        target: { type: ["object", "null"] }
                      }
                    }
                  }
                },
                required: ["id", "card_id", "row", "col", "size_x", "size_y", "parameter_mappings"]
              },
            },
            tabs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "number" },
                  name: { type: "string" },
                },
                required: ["id", "name"]
              },
            },
            parameters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  name: { type: "string" },
                  slug: { type: "string" },
                  default: { type: ["string", "number", "boolean", "null"] },
                },
                required: ["id", "type", "name", "slug"]
              },
            },
          },
          required: ["description", "name", "dashcards", "tabs", "parameters"],
        },
      },
      required: ["dashboardLayout"],
    }
  }
};

export const GetRelevantCardsTool: ToolDefinition = {
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

export const GetSourcesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "getSources",
    description: "Identify if a new measure or dimension is necessary on a model of the semantic layer",
    parameters: {
      type: "object",
      properties: {
        needsSemanticUpdate: {
          type: "boolean",
          description: "Whether a semantic layer update is needed for the task."
        },
        semanticTask: {
          type: "string",
          description: "Specific measure or dimension to create on a model of the semantic layer if needed."
        }
      },
      required: ["needsSemanticUpdate"]
    }
  }
};

export const GenerateCubeJSCubesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "generateCubeJSCubes",
    description: "Generate CubeJS cubes based on a database schema",
    parameters: {
      type: "object",
      properties: {
        cubes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name of the cube (should match table name)" },
              sql: { type: "string", description: "SQL table name for the cube" },
              measures: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: { type: "string", enum: ["count", "sum", "avg", "min", "max", "countDistinct"] },
                    sql: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["name", "type", "sql"]
                }
              },
              dimensions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: { type: "string", enum: ["string", "number", "time", "boolean"] },
                    sql: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["name", "type", "sql"]
                }
              },
              joins: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    relationship: { type: "string", enum: ["belongsTo", "hasMany", "hasOne"] },
                    sql: { type: "string" }
                  },
                  required: ["name", "relationship", "sql"]
                }
              }
            },
            required: ["name", "sql", "measures", "dimensions"]
          }
        }
      },
      required: ["cubes"]
    }
  }
};

export const TableIdentifyingTool: ToolDefinition = {
  type: "function",
  function: {
    name: "identifyRelevantTables",
    description: "Identify the most relevant tables in the schema for the given task, considering relationships between tables and choosing only the necessary tables to answer the task efficiently.",
    parameters: {
      type: "object",
      properties: {
        reasoning: {
          type: "string",
          description: "A brief explanation of why these tables were chosen and how they relate to the task. Always mention the name of the table explicitly."
        },
        relevantTables: {
          type: "array",
          description: "An array of objects representing the relevant tables. (Do not use fields, datapoints or variables, only tables)",
          items: {
            type: "object",
            properties: {
              id: {
                type: "integer",
                description: "The numeric ID of the table."
              },
              name: {
                type: "string",
                description: "The name of the table."
              }
            },
            required: ["id", "name"]
          }
        },
      },
      required: ["relevantTables", "reasoning"]
    }
  }
};

export const GeneratePlanTool: ToolDefinition = {
  type: "function",
  function: {
    name: "generatePlan",
    description: "Generates a detailed step-by-step plan for extracting insights from the table data based on the given task.",
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "array",
          description: "An array of step objects, each representing a distinct step in the insight extraction process",
          items: {
            type: "object",
            properties: {
              stepName: {
                type: "string",
                description: "A brief, descriptive name for the step"
              },
              description: {
                type: "string",
                description: "A detailed description of what this step should accomplish"
              },
              transformations: {
                type: "array",
                items: { type: "string" },
                description: "An array of data transformations required for this step"
              },
              visualization: {
                type: "string",
                description: "A suggested visualization for this step, if applicable"
              },
              expectedInsight: {
                type: "string",
                description: "The insight or information expected to be gained from this step"
              }
            },
            required: ["stepName", "description", "transformations", "expectedInsight"]
          }
        }
      },
      required: ["plan"]
    }
  }
};