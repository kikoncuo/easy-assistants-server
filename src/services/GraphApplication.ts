import { GraphManager } from './GraphManager';
import {
  getStrongestModel,
  getFasterModel,
  groqChatSmallLlama,
  anthropicSonnet,
  anthropicOpus,
  createAgent,
  anthropicHaiku,
  groqChatLlama,
  createPlanner,
  createSolver,
} from '../models/Models';
import {
  calculatorTool,
  createTableStructure,
  createChart,
  sqlQuery,
  organizeItemTool,
  getTables,
  getData,
  createDatapoint,
  askHuman,
} from '../models/Tools';

import dotenv from 'dotenv';
dotenv.config();

import { DataRecoveryGraph } from '../subgraphs/getData';
import { ViewCreationGraph } from '../subgraphs/createView';
import { InsightGraph } from '../subgraphs/getInsights';

export class GraphApplication {
  private graphManager: GraphManager;
  error: any;

  constructor(outputHandler: Function, clientAgentFunction: Function, clientData: string[]) {
    // TODO: Find a better structure for clientData

    const haiku = anthropicHaiku();
    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const llama70bGroq = groqChatLlama();
    const llama8bGroq = groqChatSmallLlama();
    const sonnet = anthropicSonnet();
    const opus = anthropicOpus();
    // If clientData is smaller than 3 elements, throw an error
    if (clientData.length < 2) {
      throw new Error(
        'When creating your GraphApplication you must provide at least 2 fields for clientData, 0 must be company and user description (TODO: use this), 1 must be the tables and their structure',
      );
    }

    const agents = {
      calculate: {
        agent: createAgent(strongestModel, [calculatorTool]),
        agentPrompt:
          'You are an LLM specialized on math operations with access to a calculator tool, you are asked to perform a math operation at the time',
        toolFunction: clientAgentFunction,
      },
      organize: {
        agent: createAgent(fasterModel, [organizeItemTool], true),
        agentPrompt: 'You are an LLM specialized on rearranging items in an array as requested by the user',
        toolFunction: clientAgentFunction,
      },
      getTables: {
        agent: createAgent(strongestModel, [getTables], true),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. 
        You are provided with a list of table names and your task is to determine the most suitable tables based on the context of the user's needs.
        Assess the table names to identify the most relevant and useful tables that align with the user's objectives for data analysis, reporting.
        Always use the tool you have access to. 
        Only use the table names that were given to you, don't use anything outside that list and don't generate new names. `,
        toolFunction: clientAgentFunction,
      },

      askHuman: {
        agent: createAgent(fasterModel, [askHuman], true),
        agentPrompt: `You are an LLM designed to assist in gathering additional information from the user when the context or provided data is insufficient to complete a task. Your goal is to ask clear and concise questions to obtain the necessary details to proceed with the given task. You should ensure that the questions are relevant to the context and structured in a way that the user can easily understand and respond to.`,
        toolFunction: clientAgentFunction,
      },

      createChart: {
        agent: createAgent(strongestModel, [createChart], true),
        agentPrompt: `You are an LLM specialized in generating chart data from JSON arrays. This Based on the input data, 
        if the chart type is not indicated, you determine the most suitable chart type or adhere to a specific type if provided. 
        You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.
        The response should always include the labels property, the data property and the chartType property.`,
        toolFunction: clientAgentFunction,
      },
      sqlQuery: {
        agent: createAgent(strongestModel, [sqlQuery], true),
        agentPrompt: `You are an LLM specialized in generating postgreSQL queries based on the input text. The postgreSQL query will be used to filter database tables. The user will provide the table's columns definition so the query is based on that information.
       This should return 2 queries, one with the results of the select part based on the user's input and also a query to create a table with a generated definition based on the result, so the first results of the query can be inserted. The table name and column names should be related to the first query.
       Example: if the user asks for an ordered list of revenue based on user id, try to generate a query like this: select "USER_ID", "NAME", sum(cast("REVENUE"::numeric)) as total_revenue from "snowflake_OFFER_CHECKOUT" group by "USER_ID", "NAME", "REVENUE" order by total_revenue desc limit 10;`,
        toolFunction: clientAgentFunction,
      },
      createDatapoint: {
        agent: createAgent(strongestModel, [createDatapoint], true),
        agentPrompt: `You are an LLM specialized in generating datapoints data from JSON arrays. This is done by using your createDatapoint tool to create the datapoint card. This should return the title of the datapoint followed by the value as data of that datapoint, and the percentage if applies.`,
        toolFunction: clientAgentFunction,
      },
    };

    const subgraphs = {
      dataAgent: {
        agentSubGraph: new DataRecoveryGraph(
          [clientAgentFunction],
          clientData[0],
          this.getConnectionChain(clientData[1]),
        ),
      },
      createView: {
        agentSubGraph: new ViewCreationGraph([clientAgentFunction]),
      },
      getInsights: {
        agentSubGraph: new InsightGraph([clientAgentFunction], clientData[0], this.getConnectionChain(clientData[1])),
      },
    };

    this.graphManager = new GraphManager(createPlanner(llama70bGroq), agents, subgraphs, llama8bGroq, outputHandler);
  }

  async processTask(task: string, thread_id: string, ws: WebSocket) {
    let config = { configurable: { thread_id: thread_id } };
    const finalResult = await this.graphManager.getApp().invoke(
      { task },
      {
        ...config,
        streamMode: 'values',
      },
    );
  }

  getConnectionChain(anonKey: string) {
    switch (anonKey) {
      case 'dbhhziresrambrdyptjh': //OmniTest
        return process.env.OMNITEST_CHAIN;
      case 'zsjqampwrmtxrjscpuud': //TalentClass
        return process.env.TALENTCLASS_CHAIN;
      case 'juqxwywkrymbfioutzvn': //BlankStreet
        return process.env.BLANKSTREET_CHAIN;
      default:
        return process.env.OMNITEST_CHAIN;
    }
  }
}
