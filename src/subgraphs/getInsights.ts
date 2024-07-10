import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import fs from 'fs';
import path from 'path';
import { executeQuery } from '../utils/DataStructure';

interface InsightState extends BaseState {
  relevantSources: string[];
  exploratoryQueries: string[];
  exploratoryResults: string[];
  titles: string[];
  finalResult: string;
  resultExecutionErrors: string[];
  resultExecutionErrorDetails: string[];
}

function readModels(): string[] {
  const modelsDirectory = path.join(__dirname, 'cubes');
  const files = fs.readdirSync( modelsDirectory );
  return files.map(file => fs.readFileSync(path.join(modelsDirectory, file), 'utf-8'));
}

function filterModels(models: string[], sources: string[]): string[] {
  return models.filter(model => {
    return sources.some(source => model.includes(`cube(\`${source}\``));
  });
}

// Node function to recover sources
async function identifyRelevantSources(state: InsightState): Promise<InsightState> {

  const cubeModels = readModels();

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

async function generateExploratoryQueries(state: InsightState): Promise<InsightState> {
  const getQueries = z.object({
    queries: z.array(z.any()).describe(`Array of Cube queries to explore the data.
      Query structure example:
      {
        "measures": [
          "Product.count"
        ],
        "dimensions": [
          "Product.group"
        ],
        "order": {
          "Product.count": "desc"
        }
      }`),
    titles: z.array(z.string()).describe(
        'Insight title, IE: get me insights for my employees, the title returned should be `Employee insights`. ',
      ),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getQueries);

  const cubeModels = readModels();
  const filteredCubeModels = filterModels(cubeModels, state.relevantSources);



  const message = await model.invoke([
    new HumanMessage(`Generate exploratory Cube queries for the following task:
    ${state.task}
    
    Use these relevant sources: ${filteredCubeModels}
    
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

async function executeExploratoryQueries(state: InsightState): Promise<InsightState> {
  let results = [];
  for (let index = 0; index < state.exploratoryQueries.length; index++) {
    const query = state.exploratoryQueries[index];
    const exploratoryResult = await executeQuery(query, 'omni_test');
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
  private prefixes: string;
  private pgConnectionChain: string | undefined;
  private functions: Function[];

  constructor(functions: Function[], prefixes: string, pgConnectionChain?: string) {
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
    this.prefixes = prefixes;
    this.pgConnectionChain = pgConnectionChain;
  }

  getGraph(): CompiledStateGraph<InsightState> {
    const subGraphBuilder = new StateGraph<InsightState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_sources', async state => await identifyRelevantSources(state))
      .addNode('generate_queries', async state => await generateExploratoryQueries(state))
      .addNode('execute_queries', async state => await executeExploratoryQueries(state))
      .addNode('analyze_results', async state => await analyzeResults(state, this.functions,))
      .addEdge(START, 'identify_sources')
      .addEdge('identify_sources', 'generate_queries')
      .addEdge('generate_queries', 'execute_queries')
      .addEdge('execute_queries', 'analyze_results')
      .addEdge('analyze_results', END);

    return subGraphBuilder.compile();
  }
}
