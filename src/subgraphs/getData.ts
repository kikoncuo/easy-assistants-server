import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { executeQueries, getDataStructure, dropSQLFunction, createPLV8function } from '../utils/DataStructure';

// Define a specific state type
interface DataRecoveryState extends BaseState {
  examples: string[];
  plv8function: string;
  explanation: string;
  description: string[];
  title: string;
  resultStatus: boolean | false;
  feedbackMessage: string | null;
  explorationQueries: string[];
  explorationResults: string[];
  finalResult: string;
  displayType: string;
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

function extractFunctionDetails(sql: string): string {
  const functionNameMatch = sql.match(/CREATE OR REPLACE FUNCTION (\w+)\(/);
  const returnsTableMatch = sql.match(/RETURNS TABLE \(([\s\S]+?)\)/);

  if (!functionNameMatch || !returnsTableMatch) {
    throw new Error('Invalid SQL string format');
  }

  const functionName = functionNameMatch[1].trim();
  const returnsTable = returnsTableMatch[1]
    .split(',')
    .map(line => line.trim())
    .join(',\n    ');

  return `Created function: ${functionName}\nThat returns:\n${returnsTable}`;
}

// Node function to recover sources
async function recoverSources(
  state: DataRecoveryState,
  filterTables: (originalString: string, tablesToKeep: string[]) => string,
  prefixes: string,
  pgConnectionChain?: string,
): Promise<DataRecoveryState> {
  const getSources = z.object({
    sources: z.array(z.string()).describe('Array with the names of the sources'),
    isPossible: z
      .string()
      .describe(
        '"true" if the data recovery is possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable',
      ),
    moreExamples: z
      .array(z.string())
      .optional()
      .describe(
        'If isPossible is maybe, provide simple and small queries to get more info or examples of the necessary tables',
      ),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getSources);

  const dataStructure = await getDataStructure(prefixes, pgConnectionChain);

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided table descriptions and examples,
        and determine which data sources could be useful in addressing the request.

        First, review the following table descriptions with 3 unique examples per table:
        ${dataStructure}
        Now, consider the following request:
        ${state.task}
        
        Keep in mind that multiple data sources may be relevant to a single request.
        If a data source seems even slightly relevant to the request, include it in your list.
        `),
  ]);

  const sources = (message as any).sources;
  const examples = filterTables(dataStructure, sources);
  const isPossible = (message as any).isPossible;
  const moreExamples = (message as any).moreExamples;
  Logger.log('\nisPossible', isPossible);
  Logger.log('\nsources', sources);
  Logger.log('\nmoreExamples', moreExamples);

  const updatedState = {
    ...state,
    examples: [examples],
  };

  if (isPossible === 'maybe') {
    updatedState.explorationQueries = moreExamples ? moreExamples : [];
  }

  return updatedState;
}

// Node function to explore additional queries
async function exploreQueries(state: DataRecoveryState, pgConnectionChain?: string): Promise<DataRecoveryState> {
  const explorationQueries = state.explorationQueries || [];
  const explorationResults = await executeQueries(explorationQueries, pgConnectionChain);

  return {
    ...state,
    explorationResults: explorationResults,
  };
}

// Node function to create SQL query
async function createPLV8Function(state: DataRecoveryState, chain?: string): Promise<DataRecoveryState> {
  const getSQL = z.object({
    assumptions: z
      .string()
      .optional()
      .describe(
        "Assumptions we made about what the user said vs how we built the function. The assumptions need to be understood by a non technical person who doesn't know the details of the database or Javascript.",
      ),
    PLV8Function: z.string()
      .describe(`PLV8 function that returns a table which satisfies the task the table must be readable by a non-technical person who does not know about IDs.
        Make the function efficient leveraging SQL and PLV8 features. Always return all the results without limit.
        Provide insightful functions, avoid simple logic unless asked to, the results of your functions will be evaluated by business and marketing experts.
        Function structure example:
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
    description: z.string().describe('Task simple description, in a simple phrase.'),
    title: z
      .string()
      .describe(
        'Task title, IE: create a chart for my top 5 beans based on price, the title returned should be `Top 5 Whole Bean/Teas Products by Price`. ',
      ),
    displayType: z
      .enum(['table', 'barChart', 'doghnutChart', 'lineChart', 'dataPoint'])
      .describe('Type of display for the query result. It can be either table, barChart, doghnutChart, or lineChart.'),
  });

  let explorationResultsString = '';
  if (state.explorationResults && state.explorationResults.length > 0) {
    explorationResultsString = state.explorationResults.map(result => `Result: ${result}\n`).join('\n');
  }

  const model = createStructuredResponseAgent(anthropicSonnet(), getSQL);

  const messageContent = state.feedbackMessage
    ? `Based on the feedback: "${state.feedbackMessage}", and the following tables with examples,
            ${state.examples}
            ${explorationResultsString ? `and the following exploration results:\n${explorationResultsString}` : ''}
            please provide a revised SQL PLV8 function with no comments that returns a table that satisfies the following task:
            ${state.task}
            Create a list with all the assumptions we had to make to the function to meet the task.
            Make one extra short assumption explaining what what the feedback was and how you addressed it.
            For displayType charts (barChart, doghnutChart, lineChart), the query should only return 2 columns, one for labels and one for values.
            For tables, the query should include a date column.
            `
    : `Based on the following tables with examples,
            ${state.examples}
            ${explorationResultsString ? `and the following exploration results:\n${explorationResultsString}` : ''}
            please provide a revised SQL PLV8 function with no comments that returns a table that satisfies the following task:
            ${state.task}
            For displayType charts (barChart, doghnutChart, lineChart), the query should only return 2 columns, one for labels and one for values.
            For tables, the query should include a date column.
            `;

  const message = await model.invoke(messageContent);
  const plv8function = (message as any).PLV8Function;
  const assumptions = (message as any).assumptions;
  const description = (message as any).description;
  const title = (message as any).title;
  const displayType = (message as any).displayType;

  Logger.log('plv8function', plv8function);
  Logger.log('assumptions', assumptions);

  const executePLV = await createPLV8function(plv8function, chain);
  console.log('🚀 ~ createPLV8Function ~ executePLV:', executePLV);

  return {
    ...state,
    plv8function: plv8function,
    explanation: assumptions,
    description: description,
    title: title,
    displayType: displayType,
  };
}

// Node function to evaluate result
async function evaluateResult(
  state: DataRecoveryState,
  functions: Function[],
  pgConnectionChain?: string,
): Promise<DataRecoveryState> {
  const functionNameMatch = state.plv8function.match(/CREATE OR REPLACE FUNCTION (\w+)\(/);
  const functionName = functionNameMatch ? functionNameMatch[1] : '';

  const getSQLResults = [
    {
      function_name: 'getSQLResults',
      arguments: {
        plv8function: state.plv8function,
        functionName: functionName,
        explanation: state.explanation,
        description: state.description,
        title: state.title,
        displayType: state.displayType,
      },
    },
  ];

  let sqlResults;
  let isCorrect = false;
  let feedbackMessage = '';

  try {
    sqlResults = JSON.stringify(await functions[0]('tool', getSQLResults));
    Logger.log('sqlResults', sqlResults);

    const getFeedback = z.object({
      isCorrect: z.boolean().describe('does the data recovered from the function look correct or not'),
      feedbackMessage: z
        .string()
        .optional()
        .describe('Feedback message if the function was incorrect. Only include this if the isCorrect is false.'),
    });

    const model = createStructuredResponseAgent(groqChatLlama(), getFeedback);

    const message = await model.invoke([
      new HumanMessage(`Based on the following user request:
                ${state.task}
                Given the following PLV8 Function,
                ${state.plv8function}
                Which returned the following results:
                ${sqlResults}
                These are the tables descriptions and their columns with examples:
                ${state.examples}
                Was the PLV8 function correct?
                isCorrect should be true if the results from the function looks correct, the results solve the task and the results are consistent and logical,
                false if it the results look incorrect, the results don't solve the task or the results are inconsistent or illogical
                (IE: Missing data that should be there, duplicated data, columns that should be smaller than others are not smaller, things that should add up are not adding up, etc).
                If not, please provide a feedback message telling us what we did wrong and how to create a better PLV8 function.
            `),
    ]);

    isCorrect = (message as any).isCorrect;
    feedbackMessage = (message as any).feedbackMessage || '';

    if (!isCorrect) {
      if (sqlResults.includes('ERROR')) {
        await dropSQLFunction(functionName, pgConnectionChain);
        return {
          ...state,
          resultStatus: false,
          feedbackMessage: feedbackMessage || 'Error creating function',
        };
      }
      await dropSQLFunction(functionName, pgConnectionChain);
    }
  } catch (error) {
    Logger.error('Error evaluating SQL results:', error);
    feedbackMessage = 'An error occurred while evaluating the SQL results.';
  }

  return {
    ...state,
    resultStatus: isCorrect,
    feedbackMessage: feedbackMessage,
    finalResult: isCorrect ? extractFunctionDetails(state.plv8function) : '',
  };
}

// DataRecoveryGraph Class
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  private pgConnectionChain: string | undefined;
  private prefixes: string;

  constructor(functions: Function[], prefixes: string, pgConnectionChain?: string) {
    const graphState: StateGraphArgs<DataRecoveryState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      examples: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      plv8function: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      explanation: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      resultStatus: {
        value: (x: boolean | false, y?: boolean | false) => (y ? y : x),
        default: () => false,
      },
      feedbackMessage: {
        value: (x: string | null, y?: string | null) => (y ? y : x),
        default: () => null,
      },
      explorationQueries: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      explorationResults: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      title: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      displayType: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      description: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
    };
    super(graphState);
    this.functions = functions;
    this.prefixes = prefixes;
    this.pgConnectionChain = pgConnectionChain;
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode(
        'recover_sources',
        async state => await recoverSources(state, filterTables, this.prefixes, this.pgConnectionChain),
      )
      .addNode('explore_queries', async state => await exploreQueries(state, this.pgConnectionChain))
      .addNode('create_plv8_function', async state => await createPLV8Function(state, this.pgConnectionChain))
      .addNode('evaluate_result', async state => await evaluateResult(state, this.functions, this.pgConnectionChain))
      .addEdge(START, 'recover_sources')
      .addConditionalEdges('recover_sources', state => {
        if (state.explorationQueries && state.explorationQueries.length > 0) {
          return 'explore_queries';
        } else {
          return 'create_plv8_function';
        }
      })
      .addEdge('explore_queries', 'create_plv8_function')
      .addEdge('create_plv8_function', 'evaluate_result')
      .addConditionalEdges('evaluate_result', state => {
        if (state.resultStatus) {
          return END;
        } else {
          return 'create_plv8_function';
        }
      });

    return subGraphBuilder.compile();
  }
}
