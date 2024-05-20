import { GraphManager } from './GraphManager';
import {
  getStrongestModel,
  getFasterModel,
  groqChatMixtral,
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
  emailTool,
  rewardTool,
  filterTool,
  eventTool,
  tableTool,
  createChart,
  infoCardTool,
  pageHtmlTool,
  sqlQuery,
  segmentTool,
  organizeItemTool,
  getTables,
  getData,
  filterData
} from '../models/Tools';
import Logger from '../utils/Logger'; 

export class GraphApplication {
  private graphManager: GraphManager;

  constructor(outputHandler: Function, clientAgentFunction: Function, clientData: string[]) { // TODO: Find a better structure for clientData
    const haiku = anthropicHaiku();
    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const llama70bGroq = groqChatLlama();
    const llama8bGroq = groqChatSmallLlama();
    const sonnet = anthropicSonnet();
    const opus = anthropicOpus();

    // If clientData is smaller than 2 elements, throw an error
    if (clientData.length < 2) {
      throw new Error('When creating your GraphApplication you must provide at least 2 fields for clientData, 0 must be company and user description (TODO: use this), 1 must be the tables and their structure');
    }

    const agents = {
      calculate: {
        agent: createAgent(llama70bGroq, [calculatorTool]),
        agentPrompt:
          'You are an LLM specialized on math operations with access to a calculator tool, you are asked to perform a math operation at the time',
        toolFunction: clientAgentFunction, 
      },
      organize: {
        agent: createAgent(fasterModel, [organizeItemTool], true),
        agentPrompt:
          'You are an LLM specialized on rearranging items in an array as requested by the user',
        toolFunction: clientAgentFunction,
      },
      filterData: {
        agent: createAgent(fasterModel, [filterData], true),
        agentPrompt:
          'You are an LLM specialized on filtering items in an array as requested by the user. Based on a stringified JSON array of data, use this tool to filter it based on user`s field request. Return the filtered array of objects.',
        toolFunction: clientAgentFunction,
      },
      getTables: {
        agent: createAgent(strongestModel, [getTables], true),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. 
        You are provided with a list of table names and your task is to determine the most suitable tables based on the context of the user's needs. The table names will always come after this string" 'based on this table names:' so only use the table names that are passed after that string.
        Assess the table names to identify the most relevant and useful tables that align with the user's objectives for data analysis, reporting.
        Always use the tool you have access to. 
        Only use the table names that were given to you, don't use anything outside that list and don't generate new names.`,
        toolFunction: clientAgentFunction,
      },
      getData: {
        agent: createAgent(strongestModel, [getData], true),
        agentPrompt: `You are an LLM specialized in generating PostgreSQL queries based on user's needs using it's tool which should always be used.
        Based on that list of table columns that the user will provide and his request, generate the postgreSQL query to adquire the user's needs. 
        Remember to not alterate any table name or column name and maintain their format.
        Here are the relevant tables: 
        ${clientData[1]}
        `,
        toolFunction: clientAgentFunction,
      },
      createChart: {
        agent: createAgent(strongestModel, [createChart], true),
        agentPrompt: `You are an LLM specialized in generating chart data from JSON arrays. This Based on the input data, 
        if the chart type is not indicated, you determine the most suitable chart type or adhere to a specific type if provided. 
        You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.`,
        toolFunction: clientAgentFunction,
      },
      sqlQuery: {
        agent: createAgent(strongestModel, [sqlQuery], true),
        agentPrompt: `You are an LLM specialized in generating postgreSQL queries based on the input text. The postgreSQL query will be used to filter database tables. The user will provide the table's columns definition so the query is based on that information.
       This should return 2 queries, one with the results of the select part based on the user's input and also a query to create a table with a generated definition based on the result, so the first results of the query can be inserted. The table name and column names should be related to the first query.
       Example: if the user asks for an ordered list of revenue based on user id, try to generate a query like this: select "USER_ID", "NAME", sum(cast("REVENUE" as numeric)) as total_revenue from "snowflake_OFFER_CHECKOUT" group by "USER_ID", "NAME", "REVENUE" order by total_revenue desc limit 10;`,
       toolFunction: clientAgentFunction,
      },
    };

    this.graphManager = new GraphManager(createPlanner(llama70bGroq), agents, createSolver(llama70bGroq), outputHandler);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    Logger.log('Final result:', finalResult);
  }
}
