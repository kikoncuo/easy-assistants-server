import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { dataExample } from './test/DataExample';
import Logger from '../utils/Logger';
// Define a specific state type
interface DataRecoveryState extends BaseState {
  examples: string[];
  sqlQuery: string;
  explanation: string;
  headers: string[];
  title: string;
  displayType: string;
  resultStatus: boolean | false;
  feedbackMessage: string | null;
  /*explorationQueries: {
        query: string;
        explanation: string;
    }[];
    explorationResults: {
        query: string;
        explanation: string;
        result: string;
    }[];*/
  finalResult: string;
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
// Node function to recover sources
async function recoverSources(
  state: DataRecoveryState,
  dataExample: string,
  filterTables: (originalString: string, tablesToKeep: string[]) => string,
): Promise<DataRecoveryState> {
  const getSources = z.object({
    sources: z.array(z.string()).describe('Array with the names of the sources'),
    isPossible: z
      .string()
      .describe(
        '"true" if the data recovery possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable',
      ),
    moreExamples: z
      .string()
      .optional()
      .describe('If isPossible is false, provide the tables you need more examples of'),
  });
  const model = await createStructuredResponseAgent(anthropicSonnet(), getSources);
  const allSources = dataExample;
  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided table descriptions and examples, and determine which data sources could be useful in addressing the request.
        First, review the following table descriptions with 3 unique examples per table:
        ${allSources}
        Now, consider the following request:
        ${state.task}
        To complete this task, follow these steps:
        1. Carefully read and understand the request.
        2. Review each data source in the provided list.
        3. For each data source, consider whether it contains information that could be relevant to the request in any way, even if it's not a perfect match.
        4. Keep in mind that multiple data sources may be relevant to a single request.
        5. If a data source seems even slightly relevant, include it in your list.
        `),
  ]);
  const sources = (message as any).sources;
  const examples = filterTables(allSources, sources);
  const isPossible = (message as any).isPossible;
  const moreExamples = (message as any).moreExamples;
  Logger.log('\nisPossible', isPossible); // TODO: Use this to decide if we should continue and do exploratory tasks if the result is maybe or fail the request if it's false
  Logger.log('\nsources', sources); // TODO: Use this to decide if we should continue and do exploratory tasks or not
  Logger.log('\nmoreExamples', moreExamples);
  return {
    ...state,
    examples: [examples],
  };
}
// Node function to create SQL query
async function createSQLQuery(state: DataRecoveryState): Promise<DataRecoveryState> {
  const getSQL = z.object({
    assumptions: z
      .string()
      .optional()
      .describe(
        `List of assumptions in a bullet list we made about what the user said vs how we built the query and why we had to make them.
        IE: the user said "give me my beans product" and there is no column named "beans" in the table, but there is a column group with a variable Whole Bean/Teas, we could say We assumed that "beans products" refer to the Whole Bean/Teas product group because there is no other product column that references beans.
        If you got feedback, create an extra assumption at the end explaining what the problem was and how you fixed it.`,
      ),
    headers: z
      .string()
      .describe(
        'Headers for the SQL query so if a table is being generated, this will return the string array of the table`s headers.',
      ),
    title: z
      .string()
      .describe(
        'Task title, IE: create a chart for my top 5 beans based on price, the title returned should be `Top 5 Whole Bean/Teas Products by Price`. ',
      ),
    displayType: z
      .enum(['table', 'barChart', 'doghnutChart', 'lineChart', 'dataPoint'])
      .describe(
        'Type of display for the query result. It can be either table, barChart, doghnutChart, or lineChart. This should be defined based on users input task.',
      ),
    SQL: z
      .string()
      .describe(
        'SQL query without line breaks, the query should be minimalistic and the result must be readable by a non-technical person who does not know about IDs. If the user asks for a chart, only the necessary columns should be retrieved on the query, no extra information. IE: create a chart for my top 3 stores based on revenue, should return an array of objects and each object only include the store name and t he revenue, no extra information.',
      ),
  });
  const model = await createStructuredResponseAgent(anthropicSonnet(), getSQL);
  const messageContent = state.feedbackMessage
    ? `Based on the feedback: "${state.feedbackMessage}", and the following tables with examples,
            ${state.examples}
            please provide a revised SQL query that returns the following columns:
            ${state.task}
            The result should be readable by a non-technical person.
            For displayType charts (barChart, doghnutChart, lineChart), the query should only return 2 columns, one for labels and one for values.
            For dataPoints the query should only return one column.
            `
    : `Based on the following tables with examples,
            ${state.examples}
            please provide a SQL query that returns the following columns:
            ${state.task}
            You can't use ROUND, CEIL, FLOOR, or TRUNCATE, they are not supported by PostgreSQL.
            The result should be readable by a non-technical person.
            For displayType charts (barChart, doghnutChart, lineChart), the query should only return 2 columns, one for labels and one for values.
            For dataPoints the query should only return one column.
            `;
  const message = await model.invoke(messageContent);
  const sqlQuery = (message as any).SQL;
  const assumptions = (message as any).assumptions;
  const headers = (message as any).headers;
  const title = (message as any).title;
  const displayType = (message as any).displayType;
  Logger.log('sqlQuery', sqlQuery);
  Logger.log('assumptions', assumptions);
  return {
    ...state,
    sqlQuery: sqlQuery,
    explanation: assumptions,
    headers: headers,
    title: title,
    displayType: displayType,
  };
}
// Node function to evaluate result
async function evaluateResult(state: DataRecoveryState, functions: Function[]): Promise<DataRecoveryState> {
  const getSQLResults = [
    {
      function_name: 'getSQLResults',
      arguments: {
        sqlQuery: state.sqlQuery,
        explanation: state.explanation,
        headers: state.headers,
        title: state.title,
        displayType: state.displayType,
      },
    },
  ];
  const sqlResults = JSON.stringify(await functions[0]('tool', getSQLResults));
  const getFeedback = z.object({
    isCorrect: z.boolean().describe('does the data recovered from the query looks correct or not'),
    feedbackMessage: z
      .string()
      .optional()
      .describe(
        'Feedback message if the query was incorrect. Include the error and hints if there are any. Only include this if the query is incorrect.',
      ),
  });
  const model = await createStructuredResponseAgent(anthropicSonnet(), getFeedback);
  const message = await model.invoke([
    new HumanMessage(`Based on the following user request:
           ${state.task}
           Given the following SQL query,
           ${state.sqlQuery}
           Which returned the following results:
           ${sqlResults}
           These are the tables descriptions and their columns with examples:
           ${state.examples}
           Was this SQL query correct?
           ${state.sqlQuery}
           isCorrect should be true if the results from the query looks correct and the query solves the task, false if it the results look incorrect or the query doesn't solve the task.
           If not, please provide a feedback message telling us what we did wrong and how to create a better query.
           `),
  ]);
  const isCorrect = (message as any).isCorrect;
  const feedbackMessage = (message as any).feedbackMessage;
  Logger.log('isCorrect', isCorrect);
  Logger.log('feedbackMessage', feedbackMessage);

  const isCorrectFunction = [
    {
      function_name: 'isCorrect',
      arguments: {
        isCorrect: isCorrect,
        feedbackMessage: feedbackMessage,
      },
    },
  ];
  functions[0]('tool', isCorrectFunction);

  return {
    ...state,
    resultStatus: isCorrect,
    feedbackMessage: feedbackMessage,
    finalResult: state.sqlQuery,
  };
}
// DataRecoveryGraph Class
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  constructor(functions: Function[]) {
    const graphState: StateGraphArgs<DataRecoveryState>['channels'] = {
      task: {
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
      examples: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      headers: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      sqlQuery: {
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
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      /*explorationQueries: {
                value: (x: { query: string; explanation: string }[], y?: { query: string; explanation: string }[]) => (y ? y : x),
                default: () => [],
            },
            explorationResults: {
                value: (x: { query: string; explanation: string; result: string }[], y?: { query: string; explanation: string; result: string }[]) => (y ? y : x),
                default: () => [],
            },*/
    };
    super(graphState);
    this.functions = functions;
  }
  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });
    subGraphBuilder
      .addNode('recover_sources', state => recoverSources(state, dataExample, filterTables))
      .addEdge(START, 'recover_sources')
      .addNode('create_sql_query', state => createSQLQuery(state))
      .addEdge('recover_sources', 'create_sql_query')
      .addNode('evaluate_result', state => evaluateResult(state, this.functions))
      .addEdge('create_sql_query', 'evaluate_result')
      .addConditionalEdges('evaluate_result', state => {
        if (state.resultStatus) {
          return END;
        } else {
          return 'create_sql_query';
        }
      });
    return subGraphBuilder.compile();
  }
}
