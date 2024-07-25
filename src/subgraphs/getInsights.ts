import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, getFasterModel, getStrongestModel, groqChatLlama } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { executeQuery, getModelsData } from '../utils/DataStructure';
import { ToolDefinition } from '@langchain/core/language_models/base';

interface InsightState extends BaseState {
  relevantSources: string[];
  queries: string[];
  responses: string[];
  finalResult: string;
  needsMoreInsight: boolean;
  sufficiencyChecks: number;
}

async function getModels(company_name: string): Promise<string[]> {
  return await getModelsData(company_name);
}

function filterModels(models: string[], sources: string[]): string[] {
  const parsedModels = models.map(model => JSON.parse(model));
  const filteredModels = parsedModels.filter(model => {
    return sources.includes(model.name);
  });
  return filteredModels.map(model => JSON.stringify(model));
}

// Node function to recover sources
async function identifyRelevantSources(state: InsightState, company_name: string): Promise<InsightState> {

  const cubeModels = await getModels(company_name);

  const getSources: ToolDefinition = {
    type: "function",
    function: {
      name: "getSources",
      description: "Identify relevant data sources for a given request",
      parameters: {
        type: "object",
        properties: {
          sources: {
            type: "array",
            items: { type: "string" },
            description: "Array with the names of the cubes"
          },
          isPossible: {
            type: "string",
            enum: ["true", "maybe", "false"],
            description: '"true" if the data recovery is possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable'
          }
        },
        required: ["isPossible"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [getSources]);


  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data cube for a given request. Your goal is to analyze the provided model descriptions and examples,
        and determine which data cubes could be useful in addressing the request.

        First, review the following cube descriptions to know the dimensions and measures available:
        ${cubeModels.join('\n')}
        Now, consider the following request:
        ${state.task}
        
        Keep in mind that multiple data cubes may be relevant to a single request.
        If a data cube seems even slightly relevant to the request, include it in your list.
        `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const sources = args.sources;
  const isPossible = args.isPossible;
  Logger.log('\nisPossible', isPossible);
  Logger.log('\nsources', sources);

  const updatedState = {
    ...state,
    relevantSources: sources,
  };

  if (isPossible === 'false') {
    updatedState.finalResult = "It wasn't possible to resolve the query with the available data.";
    return updatedState;
  }

  return updatedState;
}

async function generateExploratoryQuery(state: InsightState, company_name: string): Promise<InsightState> {
  const getQueries: ToolDefinition = {
    type: "function",
    function: {
      name: "getQueries",
      description: "Generate exploratory Cube queries to gather insights",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dimensions: { type: "array", items: { type: "string" } },
                measures: { type: "array", items: { type: "string" } },
                filters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      member: { type: "string" },
                      operator: { type: "string" },
                      values: { type: "array", items: { type: "string" } }
                    },
                    required: ["member", "operator", "values"]
                  }
                },
                segments: { type: "array", items: { type: "string" } },
                order: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      member: { type: "string" },
                      direction: { type: "string", enum: ["asc", "desc"] }
                    },
                    required: ["member", "direction"]
                  }
                },
                timeDimensions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      dimension: { type: "string" },
                      granularity: { type: "string", enum: ["day", "week", "month", "year"] },
                      dateRange: {
                        type: "array",
                        items: { type: "string", format: "date" }
                      }
                    },
                    required: ["dimension"],
                    oneOf: [
                      { required: ["granularity"] },
                      { required: ["dateRange"] }
                    ],
                    additionalProperties: false
                  }
                },
                limit: { type: "integer", maximum: 500 },
              },
              required: ["dimensions", "measures", "limit"]
            },
            description: "An array of up to 3 Cube queries to explore the data"
          }
        },
        required: ["queries"]
      }
    }
  };

  const model = createStructuredResponseAgent(getStrongestModel(), [getQueries]);

  const cubeModels = await getModels(company_name);
  const filteredCubeModels = filterModels(cubeModels, state.relevantSources);

  const existingQueries = state.queries.join('\n');
  const existingResponses = state.responses.join('\n');

  const message = await model.invoke([
    new HumanMessage(`Generate up to 5 exploratory Cube queries for the following task:
    ${state.task}
    
    Only use these cubes: ${filteredCubeModels}
    
    Create efficient queries that will help gather insights. Each query should return at most 500 examples.
    Focus on queries that will provide meaningful data for analysis.
    You can make queries with only dimensions and no measures if you need to.
    Segments and filters are additive, so try not to apply opposite segments or filters (IE: don't use both high pressure and low pressure segments).
    
    Existing queries:
    ${existingQueries}
    
    Existing responses:
    ${existingResponses}
    
    Based on the existing queries and responses, create up to 3 new queries that will provide additional insights to better answer the task.`),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const newQueries = args.queries;
  Logger.log('New exploratory queries:', newQueries);

  return {
    ...state,
    queries: [...state.queries, ...newQueries.map((query: any) => JSON.stringify(query))],
  };
}

async function executeExploratoryQuery(state: InsightState, company_name: string, functions: Function[]): Promise<InsightState> {
  const existingQueriesCount = state.queries.length;
  const existingResponsesCount = state.responses.length;
  const newQueriesCount = existingQueriesCount - existingResponsesCount;
  
  if (newQueriesCount <= 0) {
    return state; // No new queries to execute
  }

  const newQueries = state.queries.slice(-newQueriesCount);
  const exploratoryResults = await Promise.all(
    newQueries.map(async (queryString) => {
      const query = JSON.parse(queryString);
      return await executeQuery(query, company_name);
    })
  );

    // Call functions[0]('tool', queries) with the new queries
    const toolQueries = newQueries.map((query: any, index: number) => ({
      function_name: 'generateExploratoryQuery',
      arguments: {
        query: query,
        queryIndex: state.queries.length + index,
        data: exploratoryResults[index]
      },
    }));
    functions[0]('tool', toolQueries);

  return {
    ...state,
    responses: [...state.responses, ...exploratoryResults],
  };
}

async function checkResponseSufficiency(state: InsightState): Promise<InsightState> {
  const checkSufficiency: ToolDefinition = {
    type: "function",
    function: {
      name: "checkSufficiency",
      description: "Check if the current responses are sufficient to answer the task",
      parameters: {
        type: "object",
        properties: {
          isEnough: {
            type: "boolean",
            description: "Whether the current responses are sufficient to answer the task"
          },
          explanation: {
            type: "string",
            description: "Explanation of why the responses are or are not sufficient"
          }
        },
        required: ["isEnough", "explanation"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [checkSufficiency]);


  const message = await model.invoke([
    new HumanMessage(`Check if the following responses are sufficient to answer the task:
    Task: ${state.task}

    Queries:
    ${state.queries.join('\n')}

    Responses:
    ${state.responses.join('\n')}

    Determine if we have enough information to extract meaningful insights or if another query would help answer the task better.

    If 2 or more responses are empty, assume that there is no data for that query which would help answer the task, which is a sufficient response.
    If only 1 response is empty assume that the query was incorrect and try to generate a new one.
    `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const isEnough = args.isEnough;
  const explanation = args.explanation;

  Logger.log('Response sufficiency check:', { isEnough, explanation });

  const updatedState = {
    ...state,
    needsMoreInsight: !isEnough,
    sufficiencyChecks: state.sufficiencyChecks + 1,
  };
  // If sufficiency checks exceed 3 times, set the finalResult
  if (updatedState.sufficiencyChecks > 3) {
    updatedState.finalResult = explanation;
    updatedState.needsMoreInsight = false; // Ensure that it goes to END
  }
  return updatedState;
}


async function analyzeResults(state: InsightState, functions: Function[], company_name: string): Promise<InsightState> {
  const getInsights: ToolDefinition = {
    type: "function",
    function: {
      name: "getInsights",
      description: "Extract insights from exploratory query results",
      parameters: {
        type: "object",
        properties: {
          insights: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Title for the insight"
                },
                description: {
                  type: "string",
                  description: "Detailed description of the insight"
                },
                relevantQuery: {
                  type: "integer",
                  description: "Index of the most relevant query for this insight"
                }
              },
              required: ["title", "description", "relevantQuery"]
            },
            description: "Array of insights extracted from all query results"
          }
        },
        required: ["insights"]
      }
    }
  };

  const model = createStructuredResponseAgent(getFasterModel(), [getInsights]);

  const cubeModels = await getModels(company_name);

  let filteredCubeModels = filterModels(cubeModels, state.relevantSources);

  const message = await model.invoke([
    new HumanMessage(`Analyze the following exploratory query results and extract relevant insights:
    Task: ${state.task}

    Used cubes:
    ${filteredCubeModels.join('\n')}

    Queries:
    ${state.queries.join('\n')}

    Responses:
    ${state.responses.join('\n')}

    Provide a list of 3-5 key insights based on all the data. Each insight should have a title, a detaileddescription, and the index of the most relevant query.
    Do not mention directly measures or dimensions, you can only mention segments and filters to explain how they work in detail. IE: Anomalies of high pressure are identified by calculating values where the presion value exceeds the average by more than two standard deviations, highlighting outliers or anomalies. 
    Always include in your insights based on the responses to explain the insight, even if they are empty, mention specific values ranges or calculations to understand the data.
    You can be certains about how the data is extracted from the cube file
    You can assume there are no issues with data retrieval, it's available and the query is correct.
    `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const insights = args.insights;

  Logger.log('Extracted insights:', insights);

  let results = insights.map((insight: any, index: number) => ({
    function_name: 'getInsights',
    arguments: {
      query: insight.relevantQuery,
      title: insight.title,
      insight: insight.description,
    },
  }));

  functions[0]('tool', results);


  const summarizeInsights: ToolDefinition = {
    type: "function",
    function: {
      name: "summarizeInsights",
      description: "Summarize the insights",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Summary of the insights"
          }
        },
        required: ["summary"]
      }
    }
  };
  const finalModel = createStructuredResponseAgent(getFasterModel(), [summarizeInsights]);
  const finalMessage = await finalModel.invoke([
    new HumanMessage(`Create a detailed message explaining the following insights:  
      ${insights.map((insight: any) => insight.description).join('\n')}`),
  ]);

  const finalArgs = finalMessage.lc_kwargs.tool_calls[0].args;
  const summary = finalArgs.summary;

  const getSummary = [
    {
      function_name: 'getSummary',
      arguments: {
        summary:  summary
      },
    }
  ];

  functions[0]('tool', getSummary);


  return {
    ...state,
    finalResult: "Insights generated from the data"
  };
}


export class InsightGraph extends AbstractGraph<InsightState> {
  private company_name: string;
  private functions: Function[];

  constructor(company_name: string, functions: Function[]) {
    const graphState: StateGraphArgs<InsightState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      relevantSources: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      queries: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      responses: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      needsMoreInsight: {
        value: (x: boolean, y?: boolean) => (y !== undefined ? y : x),
        default: () => true,
      },
      sufficiencyChecks: {  // New state channel for sufficiency check count
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
    };
    super(graphState);
    this.functions = functions;
    this.company_name = company_name;
  }

  getGraph(): CompiledStateGraph<InsightState> {
    const subGraphBuilder = new StateGraph<InsightState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_sources', async state => await identifyRelevantSources(state, this.company_name))
      .addNode('generate_query', async state => await generateExploratoryQuery(state, this.company_name))
      .addNode('execute_query', async state => await executeExploratoryQuery(state, this.company_name, this.functions))
      .addNode('check_sufficiency', async state => await checkResponseSufficiency(state))
      .addNode('analyze_results', async state => await analyzeResults(state, this.functions, this.company_name))
      .addEdge(START, 'identify_sources')
      .addEdge('identify_sources', 'generate_query')
      .addEdge('generate_query', 'execute_query')
      .addEdge('execute_query', 'check_sufficiency')
      .addConditionalEdges('check_sufficiency', state => {
        if (state.needsMoreInsight === true ) { 
          return 'generate_query';
        } else if (state.sufficiencyChecks > 3) {  // Check if sufficiency checks are more than 3
          return END;
        } else {
          return 'analyze_results';
        }
      })
      .addEdge('analyze_results', END);

    return subGraphBuilder.compile();
  }
}
