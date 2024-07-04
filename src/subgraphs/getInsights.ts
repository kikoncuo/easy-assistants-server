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
  plv8functions: string[];
  titles: string[];
  finalResult: string;
  finalResults: string[];
  resultExecutionErrors: string[];
  resultExecutionErrorDetails: string[];
  dataStructure: string;
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

  const dataStructure = state.dataStructure === "" ? await getDataStructure(prefixes, pgConnectionChain) : state.dataStructure;

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
    dataStructure,
  };
}

async function generateExploratoryQueries(state: InsightState, prefixes: string, pgConnectionChain?: string): Promise<InsightState> {
  const getQueries = z.object({
    queries: z.array(z.string()).describe('Array of SQL queries to explore the data'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getQueries);

  const dataStructure = state.dataStructure === "" ? await getDataStructure(prefixes, pgConnectionChain) : state.dataStructure;

  const message = await model.invoke([
    new HumanMessage(`Generate exploratory SQL queries for the following task:
    ${state.task}
    
    Use these relevant sources: ${filterTables(dataStructure, state.relevantSources)}
    
    Create 2-3 efficient queries that will help gather insights. Each query should return at most 50 examples.
    Focus on queries that will provide meaningful data for analysis.`),
  ]);

  const exploratoryQueries = (message as any).queries;
  Logger.log('Exploratory queries:', exploratoryQueries);

  return {
    ...state,
    exploratoryQueries,
    dataStructure,
  };
}

async function executeExploratoryQueries(state: InsightState, pgConnectionChain?: string): Promise<InsightState> {
  const exploratoryResults = await executeQueries(state.exploratoryQueries, pgConnectionChain);

  return {
    ...state,
    exploratoryResults,
  };
}

async function analyzeResults(state: InsightState, functions: Function[]): Promise<InsightState> {
  const getInsights = z.object({
    insights: z.array(z.string()).describe('Array of insights extracted from the exploratory query results'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getInsights);

  const message = await model.invoke([
    new HumanMessage(`Analyze the following exploratory query results and extract relevant insights:
    ${state.exploratoryResults.map((result, index) => `Query ${index + 1} results:\n${result}\n`).join('\n')}
    
    Consider the original task:
    ${state.task}
    
    Provide a list of 2-3 key insights based on the data.`),
  ]);

  const insights = (message as any).insights;

  const explorationResults = [
    {
      function_name: 'getExplorationResults',
      arguments: {
        insights: insights,
        queries: state.exploratoryQueries
      },
    },
  ]; 
  functions[0]('tool', explorationResults);

  Logger.log('Extracted insights:', insights);

  return {
    ...state,
    insights,
  };
}

async function createInsightFunctions(state: InsightState, prefixes: string, pgConnectionChain?: string): Promise<InsightState> {
  const getFunctionDetails = z.object({
    plv8function: z.string().describe(`PLV8 function that proves and explains the extracted insights
        Make the function efficient leveraging SQL and PLV8 features. Always return all the results without limit.
        Function structure example:
        DROP FUNCTION IF EXISTS function_name();
        CREATE OR REPLACE FUNCTION function_name()
        RETURNS TABLE (
            return parameters enclosed in double quotes
        )
        LANGUAGE plv8
        AS $$
            const salesData = plv8.execute(\`
                SQL query
            \`);

            return salesData.map(row => ({
               map the results to the return parameters
            }));

            function auxiliary_functions(parameter) {
                logic
            }
        $$;
        `),
      title: z.string().describe(
          'Insight title, IE: get me insights for my employees, the title returned should be `Employee insights`. ',
        ),
    explanation: z.string().describe('Explanation of how the function proves the insights'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getFunctionDetails);
  const dataStructure = state.dataStructure === "" ? await getDataStructure(prefixes, pgConnectionChain) : state.dataStructure;

  let plv8functions: string[] = [];
  let titles: string[] = [];
  let finalResults: string[] = [];
  let resultExecutionErrors: string[] = [];
  let resultExecutionErrorDetails: string[] = [];

  for (let index = 0; index < state.insights.length; index++) {
    const insight = state.insights[index];
    const query = state.exploratoryQueries[index];

    const message = await model.invoke([
      new HumanMessage(`Create a PLV8 function with the query (${query}) for the following insight:
      ${insight}.
      Adapt the query if neccesary to work on a PLV8 function. Don't use SQL functions for data processing, use Javascript on the PLV8 function.
      To have more context, here is all the available data as tables with descriptions and 3 unique examples per column:
      ${dataStructure}.

      Provide an explanation of how the function proves this insight.
      ${state.resultExecutionErrorDetails ? `Previous attempt resulted in an error: ${state.resultExecutionErrorDetails}\nPlease adjust the function to avoid this error.
        If the error is like 'cannot change return type of existing function', try to rename the function` : ''}`),
    ]);

    const plv8function = (message as any).plv8function;
    const explanation = (message as any).explanation;
    const title = (message as any).title;

    Logger.log('PLV8 function:', plv8function);
    Logger.log('Explanation:', explanation);

    const functionNameMatch = plv8function.match(/CREATE OR REPLACE FUNCTION (\w+)\(/);
    const functionName = functionNameMatch ? functionNameMatch[1] : '';
    const resultExecution = await createPLV8function(plv8function, functionName, pgConnectionChain);

    plv8functions.push(plv8function);
    titles.push(title);
    finalResults.push(resultExecution.toLowerCase().includes('error') ? '' : `${explanation}`);
    resultExecutionErrors.push(resultExecution.toLowerCase().includes('error') ? resultExecution : '');
    resultExecutionErrorDetails.push(resultExecution.toLowerCase().includes('error') ? resultExecution : '');
  }

  return {
    ...state,
    plv8functions,
    titles,
    finalResults,
    resultExecutionErrors,
    resultExecutionErrorDetails,
  };
}

async function checkResultExecution(functions: Function[], state: InsightState): Promise<InsightState> {
  let results = [];

  for (let i = 0; i < state.plv8functions.length; i++) {
    const functionNameMatch = state.plv8functions[i].match(/CREATE OR REPLACE FUNCTION (\w+)\(/);
    const functionName = functionNameMatch ? functionNameMatch[1] : '';

    if (state.resultExecutionErrors[i].toLowerCase().includes('error')) {
      // If there's an error in the result execution, we need to recreate the function
      results.push({
        function_name: 'getInsights',
        arguments: {
          plv8function: state.plv8functions[i],
          functionName: functionName,
          explanation: state.finalResults[i],
          title: state.titles[i],
          displayType: 'table',
        },
      });

      return {
        ...state,
        finalResults: state.finalResults.map((result, index) => (index === i ? '' : result)), // Clear the final result as it's not valid
        resultExecutionErrors: state.resultExecutionErrors,
        resultExecutionErrorDetails: state.resultExecutionErrorDetails, // Store the error details
      };
    } else {
      results.push({
        function_name: 'getInsights',
        arguments: {
          plv8function: state.plv8functions[i],
          functionName: functionName,
          explanation: state.finalResults[i],
          title: state.titles[i],
          displayType: 'table',
        },
      });
    }
  }

  functions[0]('tool', results);
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
      insights: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      plv8functions: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      finalResults: {
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
      dataStructure: {
        value: (x: string, y?: string) => (y ? y : x || ''),
        default: () => '',
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
      .addNode('identify_sources', async state => await identifyRelevantSources(state, this.prefixes, this.pgConnectionChain))
      .addNode('generate_queries', async state => await generateExploratoryQueries(state, this.prefixes, this.pgConnectionChain))
      .addNode('execute_queries', async state => await executeExploratoryQueries(state, this.pgConnectionChain))
      .addNode('analyze_results', async state => await analyzeResults(state, this.functions,))
      .addNode('create_functions', async state => await createInsightFunctions(state, this.prefixes, this.pgConnectionChain))
      .addNode('check_results', async state => await checkResultExecution(this.functions, state))
      .addEdge(START, 'identify_sources')
      .addEdge('identify_sources', 'generate_queries')
      .addEdge('generate_queries', 'execute_queries')
      .addEdge('execute_queries', 'analyze_results')
      .addEdge('analyze_results', 'create_functions')
      .addEdge('create_functions', 'check_results')
      .addConditionalEdges(
        'check_results',
        state => state.finalResults.every(result => result) ? END : 'create_functions',
      );

    return subGraphBuilder.compile();
  }
}
