import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { executeQuery, getModelsData } from '../utils/DataStructure';

interface InsightState extends BaseState {
  relevantSources: string[];
  exploratoryQueries: string[];
  exploratoryResults: string[];
  titles: string[];
  finalResult: string;
  resultExecutionErrors: string[];
  resultExecutionErrorDetails: string[];
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

async function generateExploratoryQueries(state: InsightState, company_name: string): Promise<InsightState> {
  const getQueries = z.object({
    queries: z.array(z.any()).describe(`Array of Cube queries to explore the data.
      Query structure example:
      {
        "dimensions": [
          "cube1.param1",
          "cube1.param2",
          "cube2.param1"
        ],
        "measures": [
          cube1.param5,
          cube4.param2,
          cube3.param1,
        ],
        "filters": [
          {
            "member": "cube6.param1",
            "operator": "beforeDate",
            "values": ["2023-12-31"]
          }
        ],
        "order": [
          ["cube1.param1", "desc"]
        ],
        "limit": 1000
      }`),
    titles: z.array(z.string()).describe(
        'Insight title, IE: get me insights for my employees, the title returned should be `Employee insights`. ',
      ),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getQueries);

  const cubeModels = await getModels(company_name);
  const filteredCubeModels = filterModels(cubeModels, state.relevantSources);



  const message = await model.invoke([
    new HumanMessage(`Generate exploratory Cube queries for the following task:
    ${state.task}
    
    Only use these cubes: ${filteredCubeModels}
    
    Create 2-3 efficient queries that will help gather insights. Each query should return at most 50 examples.
    Focus on queries that will provide meaningful data for analysis.`),
  ]);

  const exploratoryQueries = (message as any).queries;
  const titles = (message as any).titles;
  Logger.log('Exploratory queries:', exploratoryQueries);

  return {
    ...state,
    titles,
    exploratoryQueries
  };
}

async function executeExploratoryQueries(state: InsightState, company_name: string): Promise<InsightState> {
  let results = [];
  for (let index = 0; index < state.exploratoryQueries.length; index++) {
    const query = state.exploratoryQueries[index];
    const exploratoryResult = await executeQuery(query, company_name);
    results.push(exploratoryResult);   
  }

  return {
    ...state,
    exploratoryResults: results,
  };
}

async function analyzeResults(state: InsightState, functions: Function[]): Promise<InsightState> {
  const getInsights = z.object({
    insight: z.array(z.string()).describe('Insight extracted from the exploratory query result'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getInsights);

  for (let i = 0; i < state.exploratoryQueries.length; i++) {

    const message = await model.invoke([
      new HumanMessage(`Analyze the following exploratory query result and extract relevant insight:
      Query ${state.exploratoryQueries[i]} results:\n${state.exploratoryResults[i]}
      
      Consider the original task:
      ${state.task}
      
      Provide a list of 2-3 key insights based on the data.`),
    ]);

    const insight = (message as any).insight;

    Logger.log('Extracted insights:', insight);

    let results = [];

 
    results.push({
      function_name: 'getInsights',
      arguments: {
        query: state.exploratoryQueries[i],
        title: state.titles[i],
        displayType: 'table',
        insight: insight,
        data: state.exploratoryResults[i]
      },
    });

    functions[0]('tool', results);
  
  }

  return {
    ...state,
    finalResult: "Tables generated for the insights"
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
      exploratoryQueries: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      exploratoryResults: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      resultExecutionErrors: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      resultExecutionErrorDetails: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      titles: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      }
    };
    super(graphState);
    this.functions = functions;
    this.company_name = company_name;
  }

  getGraph(): CompiledStateGraph<InsightState> {
    const subGraphBuilder = new StateGraph<InsightState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_sources', async state => await identifyRelevantSources(state, this.company_name))
      .addNode('generate_queries', async state => await generateExploratoryQueries(state, this.company_name))
      .addNode('execute_queries', async state => await executeExploratoryQueries(state, this.company_name))
      .addNode('analyze_results', async state => await analyzeResults(state, this.functions,))
      .addEdge(START, 'identify_sources')
      .addEdge('identify_sources', 'generate_queries')
      .addEdge('generate_queries', 'execute_queries')
      .addEdge('execute_queries', 'analyze_results')
      .addEdge('analyze_results', END);

    return subGraphBuilder.compile();
  }
}
