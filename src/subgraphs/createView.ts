import { AbstractGraph, BaseState } from "./baseGraph";
import { createStructuredResponseAgent, getFasterModel, getStrongestModel } from "../models/Models";
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { z } from 'zod';
import { dataExample } from './test/DataExample.ts';


// Define a specific state type
interface ViewCreationState extends BaseState {
  relevantSources: string[];
  examples: string[];
  sqlQuery: string;
  resultStatus: string | null;
  feedbackMessage: string | null;
}

export class ViewCreationGraph extends AbstractGraph<ViewCreationState> {
  private functions: Function[];
  constructor(functions: Function[]) { // Here we can pass any functions we want to use in the subgraph
    const graphState: StateGraphArgs<ViewCreationState>["channels"] = {
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
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => "",
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

  getGraph(): CompiledStateGraph<ViewCreationState> {
    const subGraphBuilder = new StateGraph<ViewCreationState>({ channels: this.channels });

    subGraphBuilder
      .addNode("recover_sources", async (state) => {
        const getSources = z.object({
          isPossible: z.boolean().describe('is the view creation possible or not'),
          explanation: z.string().optional().describe('the data that was missing to create the view'),
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
        const explanation = (message as any).explanation;
        const isPossible = (message as any).isPossible;
        if (isPossible) {
          return {
            ...state,
            resultStatus: isPossible as any,
            examples: [],
          };
        }

        const examples = this.filterTables(allSources, sources); 

        return {
          ...state,
          relevantSources: sources as any,
          examples: [examples],
        };
      })
      .addConditionalEdges("recover_sources", (state) => {
        if (state.resultStatus == "false") {
          return END;
        } else {
          return "create_view_query";
        }
      })
      .addEdge(START, "recover_sources")
      .addNode("create_view_query", async (state) => {
        const getSQL = z.object({
          explanation: z.string().optional().describe('Explanation of the view created, a marketing team will read this explanation, make sure it is clear and understandable by someone non technical'),
          SQL: z.string().describe('SQL query which creates a view.'),
        });

        const model = createStructuredResponseAgent(getStrongestModel(), getSQL);

        const messageContent = state.feedbackMessage
          ? `Based on the feedback: "${state.feedbackMessage}", and the following tables with examples,
            ${(state.examples)}
            please provide a revised SQL query that creates a view meeting the following requirements:
            ${(state.task)}`
          : `Based on the following tables with examples,
            ${(state.examples)}
            please provide a revised SQL query that creates a view meeting the following requirements:
            ${(state.task)}`;
            
        const message = await model.invoke(messageContent);

        const sqlQuery = (message as any).SQL;
        const explanation = (message as any).explanation;

        console.log('sqlQuery', sqlQuery);
        console.log('explanation', explanation);

        // combine the explanation with the sqlQuery in a JSON object
        const combinedExplanation = {
          sqlQuery: sqlQuery,
          explanation: explanation,
        };

        return {
          ...state,
          sqlQuery: combinedExplanation as any,
        };
      })
      .addEdge("recover_sources", "create_view_query")
      .addNode("evaluate_result", async (state) => {
        const getSQLResults = [
          {
            function_name: "getSQLResults",
            arguments: {
              sqlQuery: state.sqlQuery,
            },
          }
        ]

        const undoTableCreation = [
          {
            function_name: "undoTableCreation",
            arguments: {
              sqlQuery: state.sqlQuery,
            },
          }
        ]

        const sqlResults = await this.functions[0]('tool', getSQLResults); // Here we give it the first 2 rows of the view or the error message if the query is incorrect

        const getFeedback = z.object({
          feedbackMessage: z.string().optional().describe('Feedback message if the query was incorrect. Include the error and hints if there are any. in you include a new query make sure that limit is not in uppercase'),
          isCorrect: z.boolean().describe('does the data recovered from the query looks correct or not'),
        });

        const model = createStructuredResponseAgent(getStrongestModel(), getFeedback);

        const message = await model.invoke([
          new HumanMessage(`Based on the following user request:
           ${(state.task)}
           Given the following SQL query,
           ${(state.sqlQuery)}
           Which returned the following results:
           ${(JSON.stringify(sqlResults.sqlQuery))}
           These are the tables descriptions and their columns with examples:
           ${(state.examples)}
           Was the creation of this view correct?
           ${(state.sqlQuery)}
           isCorrect should be true if the data recovered from the query looks correct, false if it looks incorrect, don't make it false if the query is good but the data is not correct.
           If not, please provide a feedback message telling us what we did wrong and how to create a better query.`)
        ]);

        const isCorrect = (message as any).isCorrect;
        const feedbackMessage = (message as any).feedbackMessage;

        console.log('isCorrect', isCorrect);
        console.log('feedbackMessage', feedbackMessage);
        console.log('state', state);

        if (isCorrect) {
          return {
            ...state,
            resultStatus: "correct",
            feedbackMessage: null,
            finalResult: "View created successfully",
          };
        } else {
          const undoResult = await this.functions[0]('tool', undoTableCreation);
          if (!undoResult.undoTableCreation) {
            console.log('Error undoing table creation', undoResult);
          }
          return {
            ...state,
            resultStatus: "incorrect",
            feedbackMessage: feedbackMessage,
          };
        }
      })
      .addEdge("create_view_query", "evaluate_result")
      .addConditionalEdges("evaluate_result", (state) => {
        if (state.resultStatus == "correct") {
          return END;
        } else {
          return "create_sql_query";
        }
      });

    return subGraphBuilder.compile();
  }
}
