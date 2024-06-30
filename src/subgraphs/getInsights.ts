import { AbstractGraph, BaseState } from "./baseGraph";
import { createStructuredResponseAgent, anthropicSonnet } from "../models/Models";
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { z } from 'zod';
import { dataExample } from './test/DataExample';
import Logger from '../utils/Logger';


// Define a specific state type
interface InsightsState extends BaseState {
    task: string;
    relevantFunctions: string[];
    SQL: string;
    insightRequest: string;
    isPossible: boolean | false;
    feedbackMessage: string | null;
    finalResult: string;
}

// Node function to recover sources
async function recoverFunctions(state: InsightsState): Promise<InsightsState> {
    const getFunctions = z.object({
        functions: z.array(z.string()).optional().describe('Array of the available data that are relevant to create the insight'),
        isPossible: z.string().describe('"true" if we can extract insights from the available data, maybe if more data would help us create better insights, false if we need to create new data tables to answer the question'),
        newFunction: z.string().optional().describe('If isPossible is false, use this field to explain the user we don\'t have the required data yet, and describe the user what table could be useful to create better insights. If isPossible is maybe, phrase it as a suggestion. Be very direct and efficient, listing all the fields in the table.'),
    });

    const model = await createStructuredResponseAgent(anthropicSonnet(), getFunctions);
    const allSources = dataExample;
    const allFunctions = `get_store_5_performance_metrics
    That returns:
    "Date" date,
        "Total Sales" numeric,
        "Customer Traffic" bigint,
        "Conversion Rate" numeric,
        "Average Transaction Value" numeric`;

    const message = await model.invoke([
        new HumanMessage(`You need to identify if the following available data:
        ${(allFunctions)}
        Are enough to extract this insight:
        ${(state.task)}
        Here are is all my available data explained as tables with descriptions and 3 unique examples per column.
        ${allSources}
        You can use them to help you decide if the available data enough to extract the insight or if we should first create a new table using the existing data.
        `)
    ]);

    const functions = (message as any).functions;
    const isPossible = (message as any).isPossible;
    const newFunction = (message as any).newFunction;
    Logger.log('\nTask was', state.task);
    Logger.log('\nisPossible', isPossible); // TODO: Use this to decide if we should continue and do exploratory tasks if the result is maybe or fail the request if it's false
    Logger.log('\fFunctions', functions); // TODO: Use this to decide if we should continue and do exploratory tasks or not 
    Logger.log('\nNewFunction', newFunction);

    if (isPossible == "true" || isPossible == "maybe") {
        return {
            ...state,
            relevantFunctions: functions,
            isPossible : true,
            finalResult: "Insights extracted successfully",
        };
    } else {
        return {
            ...state,
            isPossible : false,
            finalResult: newFunction,
        };
    }
}

// We need to:
/*
1. Ask the user if we want to proceed in maybe
2. Ask the user if they want to create the new table
3. Create the new table based on the newFunction field using getData
4. Run the functions (selected in relevantFunctions amd created as newFunction) and return the result
5. Filter the results by ordering the tables since we can't return all the data
6. Extract the insight from the result
*/ 


// insightsGraph Class
export class InsightsGraph extends AbstractGraph<InsightsState> {
    private functions: Function[];

    constructor(functions: Function[]) {
        const graphState: StateGraphArgs<InsightsState>["channels"] = {
            task: {
                value: (x: string, y?: string) => (y ? y : x),
                default: () => "",
            },
            relevantFunctions: {
                value: (x: string[], y?: string[]) => (y ? y : x),
                default: () => [],
            },
            SQL: {
                value: (x: string, y?: string) => (y ? y : x),
                default: () => "",
            },
            insightRequest: {
                value: (x: string, y?: string) => (y ? y : x),
                default: () => "",
            },
            isPossible: {
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
        };
        super(graphState);
        this.functions = functions;
    }

    getGraph(): CompiledStateGraph<InsightsState> {
        const subGraphBuilder = new StateGraph<InsightsState>({ channels: this.channels });

        subGraphBuilder
            .addNode("recover_functions", (state) => recoverFunctions(state))
            .addEdge(START, "recover_functions")
            .addConditionalEdges("recover_functions", (state) => {
                if (state.isPossible) {
                    return END;
                } else {
                    return END;;
                }
            });

        return subGraphBuilder.compile();
    }
}
