import { AbstractGraph, BaseState } from "./baseGraph";
import { createStructuredResponseAgent, getFasterModel } from "../models/Models";
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { z } from 'zod';
import { dataExample } from './test/DataExample';


// Define a specific state type
interface DataRecoveryState extends BaseState {
  relevantSources: string[];
  examples: string[];
  sqlQuery: string;
  resultStatus: string | null;
  feedbackMessage: string | null;
}

export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  constructor(functions: Function[]) { // Here we can pass any functions we want to use in the subgraph
    const graphState: StateGraphArgs<DataRecoveryState>["channels"] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => "",
      },
      relevantSources: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      examples: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      sqlQuery: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => "",
      },
      resultStatus: {
        value: (x: string | null, y?: string | null) => (y ? y : x),
        default: () => null,
      },
      feedbackMessage: {
        value: (x: string | null, y?: string | null) => (y ? y : x),
        default: () => null,
      },
    };
    super(graphState);
    this.functions = functions;
  }

 filterTables(originalString: string, tablesToKeep: string[]): string {
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

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode("recover_sources", async (state) => {
        const getSources = z.object({
          sources: z.array(z.string()).describe('The best sources to use for the query'),
        });

        const model = await createStructuredResponseAgent(getFasterModel(), getSources);

        const allSources = dataExample; // We would get this from the function like the examples below, but we don't have that function working in the frontend yet

        //console.log('allSources', allSources);
        console.log('invoking model');
        const message = await model.invoke([
          new HumanMessage(`Based on the following table names and their structure,
          ${allSources}
          Please provide the best sources to use for the query: ${(state.task)}`)
        ]);
        console.log('message', message);
        const sources = (message as any).sources;

        const examples = this.filterTables(allSources, sources); 

        return {
          ...state,
          relevantSources: sources as any,
          examples: [examples],
        };
      })
      .addEdge(START, "recover_sources")
      .addNode("create_sql_query", async (state) => {
        const getSQL = z.object({
          SQL: z.string().describe('SQL query'),
        });

        const model = createStructuredResponseAgent(getFasterModel(), getSQL);

        const messageContent = state.feedbackMessage
          ? `Based on the feedback: "${state.feedbackMessage}", and the following tables,
            ${(state.relevantSources)}
            and the following examples,
            ${(state.examples)}
            please provide a revised SQL query that returns the following columns:
            ${(state.task)}`
          : `Based on the following tables,
            ${(state.relevantSources)}
            and the following examples,
            ${(state.examples)}
            please provide a SQL query that returns the following columns:
            ${(state.task)}`;
        console.log('Create SQL ', messageContent);
        const message = await model.invoke(messageContent);

        const sqlQuery = (message as any).SQL;

        console.log('sqlQuery', sqlQuery);

        return {
          ...state,
          sqlQuery: sqlQuery as any,
        };
      })
      .addEdge("recover_sources", "create_sql_query")
      .addNode("evaluate_result", async (state) => {
        const getSQLResults = [
          {
            function_name: "getSQLResults",
            arguments: {
              sqlQuery: state.sqlQuery,
            },
          }
        ]

        const sqlResults = await this.functions[0]('tool', getSQLResults); // Example using to get the result of the SQL query, need to update this name to make it work with the frontend by default

        const getFeedback = z.object({
          isCorrect: z.boolean().describe('is Correct or not'),
          feedbackMessage: z.string().optional().describe('Feedback message if the query was incorrect'),
        });

        const model = createStructuredResponseAgent(getFasterModel(), getFeedback);

        const message = await model.invoke([
          new HumanMessage(`Based on the following user request:
           ${(state.task)}
           Given the following SQL query,
           ${(state.sqlQuery)}
           Which returned the following results:
           ${(sqlResults)}
           These are the tables descriptions and their columns with examples:
           ${(state.relevantSources)}
           ${(state.examples)}
           Was this SQL query correct?
           ${(state.sqlQuery)}
           If not, please provide a feedback message telling us what we did wrong and how to create a better query.`)
        ]);

        const isCorrect = (message as any).isCorrect;
        const feedbackMessage = (message as any).feedbackMessage;

        console.log('isCorrect', isCorrect);
        console.log('feedbackMessage', feedbackMessage);

        if (isCorrect) {
          return {
            ...state,
            resultStatus: "correct",
            feedbackMessage: null,
          };
        } else {
          return {
            ...state,
            resultStatus: "incorrect",
            feedbackMessage: feedbackMessage,
          };
        }
      })
      .addEdge("create_sql_query", "evaluate_result")
      .addConditionalEdges("evaluate_result", (state) => {
        if (state.resultStatus === "correct") {
          return END;
        } else {
          return "create_sql_query";
        }
      });

    return subGraphBuilder.compile();
  }
}
