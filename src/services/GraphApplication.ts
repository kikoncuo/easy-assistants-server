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
  chartTool,
  infoCardTool,
  pageHtmlTool,
  sqlQuery,
  segmentTool,
  organizeItemTool,
  getTables,
  getSegmentDetails,
  filterData
} from '../models/Tools';
import Logger from '../utils/Logger'; 

export class GraphApplication {
  private graphManager: GraphManager;

  constructor(outputHandler: Function, clientAgentFunction: Function) {
    const haiku = anthropicHaiku();
    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const llama70bGroq = groqChatLlama();
    const llama8bGroq = groqChatSmallLlama();
    const sonnet = anthropicSonnet();
    const opus = anthropicOpus();

    const agents = {
      calculate: {
        agent: createAgent(fasterModel, [calculatorTool]),
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
      },
      getTables: {
        agent: createAgent(strongestModel, [getTables], true),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. 
        You are provided with a list of table names and your task is to determine the most suitable tables based on the context of the user's needs. The table names will always come after this string" 'based on this table names:' so only use the table names that are passed after that string.
        Assess the table names to identify the most relevant and useful tables that align with the user's objectives for data analysis, reporting.
        Always use the tool you have access to. 
        Only use the table names that were given to you, don't use anything outside that list and don't generate new names.`,
      },
      getSegmentDetails: {
        agent: createAgent(strongestModel, [getSegmentDetails], true),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. Use this tool only if asked for, it's not mandatory for other tools to be used alongside this one.
        Based on that list of table columns that the user will provide and his request, generate the postgreSQL query to adquire the user's needs. 
        Remember to not alterate any table name or column name and maintain their format.
        Try to return as much details as possible based on the request.
        Example: if the user asks for an ordered list of revenue based on user id, try to generate a query like this: select "USER_ID", "NAME", "EMAIL", sum(cast("REVENUE" as numeric)) as total_revenue from "snowflake_OFFER_CHECKOUT" group by "USER_ID", "REVENUE" order by total_revenue desc;`,
      },
      createChart: {
        agent: createAgent(strongestModel, [chartTool], true),
        agentPrompt: `You are an LLM specialized in generating chart data from JSON arrays. Based on the input data, if the chart type is not indicated, you determine the most suitable chart type or adhere to a specific type if provided. You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.
          The response should always include the labels property and the data property like this example: 
          arguments: {
            labels: [ "Label, Label, Label, Label" ],
            data: [ "1, 2, 3, 4" ],
            chartType: "line",
          }.`,
      },
    };

    this.graphManager = new GraphManager(createPlanner(llama8bGroq), agents, createSolver(llama70bGroq), outputHandler);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    Logger.log('Final result:', finalResult);
  }
}
