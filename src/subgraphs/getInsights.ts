import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { executeQuery, getModelsData } from '../utils/DataStructure';

interface InsightState extends BaseState {
  relevantSources: string[];
  queries: string[];
  responses: string[];
  finalResult: string;
  needsMoreInsight: boolean;
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

  const getSources = z.object({
    sources: z.array(z.string()).describe('Array with the names of the sources'),
    isPossible: z
      .string()
      .describe(
        '"true" if the data recovery is possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable',
      ),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getSources);

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided model descriptions and examples,
        and determine which data sources could be useful in addressing the request.

        First, review the following model descriptions to know the dimensions and measures available:
        ${cubeModels.join('\n')}
        Now, consider the following request:
        ${state.task}
        
        Keep in mind that multiple data sources may be relevant to a single request.
        If a data source seems even slightly relevant to the request, include it in your list.
        `),
  ]);

  const sources = (message as any).sources;
  const isPossible = (message as any).isPossible;
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
  const getQueries = z.object({
    queries: z.array(z.any()).describe(`An array of up to 3 Cube queries to explore the data.
      Query structure example:
      {
        "dimensions": [
          "cube1.param1",
          "cube1.param2",
          "cube2.param1"
        ],
        "measures": [
          "cube1.param5",
          "cube4.param2",
          "cube3.param1"
        ],
        "filters": [
          {
            "member": "cube6.param1",
            "operator": "beforeDate",
            "values": ["2023-12-31"]
          }
        ],
        "segments": [
          "cube1.segment1"
        ],
        "order": [
          ["cube1.param1", "desc"]
        ],
        "limit": 1000
      }`),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getQueries);

  const cubeModels = await getModels(company_name);
  const filteredCubeModels = filterModels(cubeModels, state.relevantSources);

  const existingQueries = state.queries.join('\n');
  const existingResponses = state.responses.join('\n');

  const message = await model.invoke([
    new HumanMessage(`Generate up to 5 exploratory Cube queries for the following task:
    ${state.task}
    
    Only use these cubes: ${filteredCubeModels}
    
    Create efficient queries that will help gather insights. Each query should return at most 1000 examples.
    Focus on queries that will provide meaningful data for analysis.
    You can make queries with only dimensions and no measures if you need to.
    Segments and filters are additive, so try not to apply opposite segments or filters.
    
    Existing queries:
    ${existingQueries}
    
    Existing responses:
    ${existingResponses}
    
    Based on the existing queries and responses, create up to 3 new queries that will provide additional insights to better answer the task.`),
  ]);

  const newQueries = (message as any).queries;
  Logger.log('New exploratory queries:', newQueries);

  return {
    ...state,
    queries: [...state.queries, ...newQueries.map((query: any) => JSON.stringify(query))],
  };
}

async function executeExploratoryQuery(state: InsightState, company_name: string): Promise<InsightState> {
  const newQueries = state.queries.slice(-3); // Get the last 3 queries (or fewer if less than 3 were added)
  const exploratoryResults = await Promise.all(
    newQueries.map(async (queryString) => {
      const query = JSON.parse(queryString);
      return await executeQuery(query, company_name);
    })
  );

  return {
    ...state,
    responses: [...state.responses, ...exploratoryResults],
  };
}

async function analyzeResults(state: InsightState, functions: Function[], company_name: string): Promise<InsightState> {
  const getInsights = z.object({
    insights: z.array(z.object({
      title: z.string().describe('Title for the insight'),
      description: z.string().describe('Detailed description of the insight'),
      relevantQuery: z.number().describe('Index of the most relevant query for this insight'),
    })).describe('Array of insights extracted from all query results'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getInsights);

  const cubeModels = await getModels(company_name);

  let filteredCubeModels = filterModels(cubeModels, state.relevantSources);;

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

  const insights = (message as any).insights;

  Logger.log('Extracted insights:', insights);

  let results = insights.map((insight: any, index: number) => ({
    function_name: 'getInsights',
    arguments: {
      query: state.queries[insight.relevantQuery],
      title: insight.title,
      displayType: 'table',
      insight: insight.description,
      data: state.responses[insight.relevantQuery]
    },
  }));

  functions[0]('tool', results);

  return {
    ...state,
    finalResult: "Insights generated from the data"
  };
}

async function checkResponseSufficiency(state: InsightState): Promise<InsightState> {
  const checkSufficiency = z.object({
    isEnough: z.boolean().describe('Whether the current responses are sufficient to answer the task'),
    explanation: z.string().describe('Explanation of why the responses are or are not sufficient'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), checkSufficiency);

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

  const isEnough = (message as any).isEnough;
  const explanation = (message as any).explanation;

  Logger.log('Response sufficiency check:', { isEnough, explanation });

  return {
    ...state,
    needsMoreInsight: !isEnough,
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
      .addNode('execute_query', async state => await executeExploratoryQuery(state, this.company_name))
      .addNode('check_sufficiency', async state => await checkResponseSufficiency(state))
      .addNode('analyze_results', async state => await analyzeResults(state, this.functions, this.company_name))
      .addEdge(START, 'identify_sources')
      .addEdge('identify_sources', 'generate_query')
      .addEdge('generate_query', 'execute_query')
      .addEdge('execute_query', 'check_sufficiency')
      .addConditionalEdges('check_sufficiency', state => {
        if (state.needsMoreInsight === true ) { 
          return 'generate_query';
        } else {
          return 'analyze_results';
        }
      })
      .addEdge('analyze_results', END);

    return subGraphBuilder.compile();
  }
}
