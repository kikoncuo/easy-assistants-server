import { AbstractGraph, BaseState } from "./baseGraph";
import { createStructuredResponseAgent, anthropicSonnet } from "../models/Models";
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { z } from 'zod';
import { dataExample } from './test/DataExample';
import Logger from '../utils/Logger';


// Define a specific state type
interface DataRecoveryState extends BaseState {
    examples: string[];
    sqlQuery: string;
    explanation: string;
    resultStatus: boolean | false;
    feedbackMessage: string | null;
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

function extractFunctionDetails(sql: string): string {
    const functionNameMatch = sql.match(/CREATE OR REPLACE FUNCTION (\w+)\(/);
    const returnsTableMatch = sql.match(/RETURNS TABLE \(([\s\S]+?)\)/);

    if (!functionNameMatch || !returnsTableMatch) {
        throw new Error("Invalid SQL string format");
    }

    const functionName = functionNameMatch[1].trim();
    const returnsTable = returnsTableMatch[1]
        .split(',')
        .map(line => line.trim())
        .join(',\n    ');

    return `Created function: ${functionName}\nThat returns:\n${returnsTable}`;
}

// Node function to recover sources
async function recoverSources(state: DataRecoveryState, dataExample: string, filterTables: (originalString: string, tablesToKeep: string[]) => string): Promise<DataRecoveryState> {
    const getSources = z.object({
        sources: z.array(z.string()).describe('Array with the names of the sources'),
        isPossible: z.string().describe('"true" if the data recovery possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable'),
        moreExamples: z.string().optional().describe('If isPossible is false, provide the tables you need more examples of'),
    });

    const model = await createStructuredResponseAgent(anthropicSonnet(), getSources);
    const allSources = dataExample;

    const message = await model.invoke([
        new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided table descriptions and examples, and determine which data sources could be useful in addressing the request.

        First, review the following table descriptions with 3 unique examples per column:
        ${allSources}
        Now, consider the following request:
        ${(state.task)}
        To complete this task, follow these steps:

        1. Carefully read and understand the request.
        2. Review each data source in the provided list.
        3. For each data source, consider whether it contains information that could be relevant to the request in any way, even if it's not a perfect match.
        4. Keep in mind that multiple data sources may be relevant to a single request.
        5. If a data source seems even slightly relevant, include it in your list.
        `)
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
        assumptions: z.string().optional().describe('Assumptions we made about what the user said vs how we built the function. The assumptions need to be understood by a non technical person who doesn\'t know the details of the database or Javascript.'),  
        PLV8Function: z.string().describe(`PLV8 function that returns a table which satisfies the task the table must be readable by a non-technical person who does not know about IDs.
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
        `)
    });

    const model = await createStructuredResponseAgent(anthropicSonnet(), getSQL);

    const messageContent = state.feedbackMessage
        ? `Based on the feedback: "${state.feedbackMessage}", and the following tables with examples,
            ${(state.examples)}
            please provide a revised SQL PLV8 function with no comments that returns a table that satisfies the following task:
            ${(state.task)}
            Create a list with all the assumptions we had to make to the function to meet the task.
            Make one extra short assumption explaining what what the feedback was and how you addressed it.
            `
        : `Based on the following tables with examples,
            ${(state.examples)}
            please provide a revised SQL PLV8 function with no comments that returns a table that satisfies the following task:
            ${(state.task)}
            `;

    const message = await model.invoke(messageContent);
    const sqlQuery = (message as any).PLV8Function;
    const assumptions = (message as any).assumptions;

    Logger.log('sqlQuery', sqlQuery);
    Logger.log('assumptions', assumptions);

    return {
        ...state,
        sqlQuery: sqlQuery,
        explanation: assumptions,
    };
}

// Node function to evaluate result
async function evaluateResult(state: DataRecoveryState, functions: Function[]): Promise<DataRecoveryState> {
    const getSQLResults = [
        {
            function_name: "getSQLResults",
            arguments: {
                sqlQuery: state.sqlQuery,
                explanation: state.explanation,
            },
        }
    ];

    const sqlResults = JSON.stringify((await functions[0]('tool', getSQLResults)));

    const getFeedback = z.object({
      isCorrect: z.boolean().describe('does the data recovered from the function look correct or not'),
      feedbackMessage: z.string().optional().describe('Feedback message if the function was incorrect. Only include this if the isCorrect is false.'),
    });

    const model = await createStructuredResponseAgent(anthropicSonnet(), getFeedback);

    const message = await model.invoke([
        new HumanMessage(`Based on the following user request:
           ${(state.task)}
           Given the following PLV8 Function,
           ${(state.sqlQuery)}
           Which returned the following results:
           ${(sqlResults)}
           These are the tables descriptions and their columns with examples:
           ${(state.examples)}
           Was the PLV8 function correct?
           isCorrect should be true if the results from the function looks correct and the results solve the task, false if it the results look incorrect or the results don't solve the task.
           If not, please provide a feedback message telling us what we did wrong and how to create a better PLV8 function.
           `)
    ]);

    const isCorrect = (message as any).isCorrect;
    const feedbackMessage = (message as any).feedbackMessage;

    Logger.log('isCorrect', isCorrect);
    Logger.log('feedbackMessage', feedbackMessage);

    return {
      ...state,
      resultStatus: isCorrect,
      feedbackMessage: feedbackMessage,
      finalResult: extractFunctionDetails(state.sqlQuery)
    };

}

// DataRecoveryGraph Class
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
    private functions: Function[];

    constructor(functions: Function[]) {
        const graphState: StateGraphArgs<DataRecoveryState>["channels"] = {
            task: {
                value: (x: string, y?: string) => (y ? y : x),
                default: () => "",
            },
            examples: {
                value: (x: string[], y?: string[]) => (y ? y : x),
                default: () => [],
            },
            sqlQuery: {
                value: (x: string, y?: string) => (y ? y : x),
                default: () => "",
            },
            explanation: {
                value: (x: string, y?: string) => (y ? y : x),
                default: () => "",
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
                default: () => "",
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
            .addNode("recover_sources", (state) => recoverSources(state, dataExample, filterTables))
            .addEdge(START, "recover_sources")
            .addNode("create_sql_query", (state) => createSQLQuery(state))
            .addEdge("recover_sources", "create_sql_query")
            .addNode("evaluate_result", (state) => evaluateResult(state, this.functions))
            .addEdge("create_sql_query", "evaluate_result")
            .addConditionalEdges("evaluate_result", (state) => {
                if (state.resultStatus) {
                    return END;
                } else {
                    return "create_sql_query";
                }
            });

        return subGraphBuilder.compile();
    }
}
