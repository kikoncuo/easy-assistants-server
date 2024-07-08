import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { executeQueries, getDataStructure, createPLV8function } from '../utils/DataStructure';

interface InsightState extends BaseState {
  relevantSources: string[];
  exploratoryQueries: string[];
  exploratoryResults: string[];
  insights: string[];
  plv8function: string;
  finalResult: string;
  resultExecution: string;
  resultExecutionError: string;
}

// Helper function to filter tables
function filterTables(originalString: string, tablesToKeep: string[]): string {
  const tableRegex = /Table: (\w+)\n([\s\S]*?)(?=Table: \w+|\s*$)/g;
  let match;
  let filteredString = 'Tables:\n\n';

  while ((match = tableRegex.exec(originalString)) !== null) {
    const tableName = match[1];
    const tableContent = match[2];
    if (tablesToKeep.includes(tableName)) {
      filteredString += `Table: ${tableName}\n${tableContent}\n`;
    }
  }

  return filteredString.trim();
}

async function identifyRelevantSources(state: InsightState, prefixes: string, pgConnectionChain?: string): Promise<InsightState> {
  const getSources = z.object({
    sources: z.array(z.string()).describe('Array with the names of the relevant sources'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getSources);

  const dataStructure = await getDataStructure(prefixes, pgConnectionChain);

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for the following task:
    ${state.task}
    
    Review the following table descriptions:
    ${dataStructure}
    
    Identify and list the names of the tables that are most relevant to the task.`),
  ]);

  const relevantSources = (message as any).sources;
  Logger.log('Relevant sources:', relevantSources);

  return {
    ...state,
    relevantSources,
  };
}

async function generateExploratoryQueries(state: InsightState, prefixes: string, pgConnectionChain?: string): Promise<InsightState> {
  const getQueries = z.object({
    queries: z.array(z.string()).describe('Array of SQL queries to explore the data'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getQueries);

  const dataStructure = await getDataStructure(prefixes, pgConnectionChain); // TODO: avoid calling this twice

  const message = await model.invoke([
    new HumanMessage(`Generate exploratory SQL queries for the following task:
    ${state.task}
    
    Use these relevant sources: ${filterTables(dataStructure, state.relevantSources)}
    
    Create 3-5 efficient queries that will help gather insights. Each query should return at most 50 examples.
    Focus on queries that will provide meaningful data for analysis.`),
  ]);

  const exploratoryQueries = (message as any).queries;
  Logger.log('Exploratory queries:', exploratoryQueries);

  return {
    ...state,
    exploratoryQueries,
  };
}

async function executeExploratoryQueries(state: InsightState, pgConnectionChain?: string): Promise<InsightState> {
  const exploratoryResults = await executeQueries(state.exploratoryQueries, pgConnectionChain);

  return {
    ...state,
    exploratoryResults,
  };
}

async function analyzeResults(state: InsightState): Promise<InsightState> {
  const getInsights = z.object({
    insights: z.array(z.string()).describe('Array of insights extracted from the exploratory query results'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getInsights);

  const message = await model.invoke([
    new HumanMessage(`Analyze the following exploratory query results and extract relevant insights:
    ${state.exploratoryResults.map((result, index) => `Query ${index + 1} results:\n${result}\n`).join('\n')}
    
    Consider the original task:
    ${state.task}
    
    Provide a list of 3-5 key insights based on the data.`),
  ]);

  const insights = (message as any).insights;
  Logger.log('Extracted insights:', insights);

  return {
    ...state,
    insights,
  };
}

async function createInsightFunction(state: InsightState, pgConnectionChain?: string): Promise<InsightState> {
  const getFunctionDetails = z.object({
    plv8function: z.string().describe('PLV8 function that proves and explains the extracted insights'),
    explanation: z.string().describe('Explanation of how the function proves the insights'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getFunctionDetails);

  const message = await model.invoke([
    new HumanMessage(`Create a PLV8 function that proves and explains the following insights:
    ${state.insights.join('\n')}
    
    The function should return a table with columns that help demonstrate the insights.
    Provide an explanation of how the function proves these insights.
    
    Original task:
    ${state.task}
    
    ${state.resultExecutionError ? `Previous attempt resulted in an error: ${state.resultExecutionError}\nPlease adjust the function to avoid this error.` : ''}`),
  ]);

  const plv8function = (message as any).plv8function;
  const explanation = (message as any).explanation;

  Logger.log('PLV8 function:', plv8function);
  Logger.log('Explanation:', explanation);

  const functionNameMatch = plv8function.match(/CREATE OR REPLACE FUNCTION (\w+)\(/);
  const functionName = functionNameMatch ? functionNameMatch[1] : '';
  const resultExecution = await createPLV8function(plv8function, functionName, pgConnectionChain);

  return {
    ...state,
    plv8function,
    resultExecution,
    finalResult: `${explanation}\n\nFunction execution result:\n${resultExecution}`,
  };
}

async function checkResultExecution(state: InsightState): Promise<InsightState> {
  if (state.resultExecution.toLowerCase().includes('error')) {
    // If there's an error in the result execution, we need to recreate the function
    return {
      ...state,
      finalResult: '', // Clear the final result as it's not valid
      resultExecutionError: state.resultExecution,
    };
  }
  // If there's no error, we can proceed to end the process
  return state;
}

export class InsightGraph extends AbstractGraph<InsightState> {
  private prefixes: string;
  private pgConnectionChain: string | undefined;

  constructor(prefixes: string, pgConnectionChain?: string) {
    const graphState: StateGraphArgs<InsightState>['channels'] = {
      task: {
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
      insights: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      plv8function: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      resultExecution: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      resultExecutionError: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
    };
    super(graphState);
    this.prefixes = prefixes;
    this.pgConnectionChain = pgConnectionChain;
  }

  getGraph(): CompiledStateGraph<InsightState> {
    const subGraphBuilder = new StateGraph<InsightState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_sources', async state => await identifyRelevantSources(state, this.prefixes, this.pgConnectionChain))
      .addNode('generate_queries', async state => await generateExploratoryQueries(state, this.prefixes, this.pgConnectionChain))
      .addNode('execute_queries', async state => await executeExploratoryQueries(state, this.pgConnectionChain))
      .addNode('analyze_results', async state => await analyzeResults(state))
      .addNode('create_function', async state => await createInsightFunction(state, this.pgConnectionChain))
      .addNode('check_result', async state => await checkResultExecution(state))
      .addEdge(START, 'identify_sources')
      .addEdge('identify_sources', 'generate_queries')
      .addEdge('generate_queries', 'execute_queries')
      .addEdge('execute_queries', 'analyze_results')
      .addEdge('analyze_results', 'create_function')
      .addEdge('create_function', 'check_result')
      .addConditionalEdges(
        'check_result',
        state => state.finalResult ? END : 'create_function',
      );

    return subGraphBuilder.compile();
  }
}
