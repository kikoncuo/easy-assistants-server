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
  getData,
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
        agentPrompt: `You are an LLM specialized in generating SQL queries based on user's needs.
        Based on that list of table columns that the user will provide and his request, generate the postgreSQL query to adquire the user's needs. 
        Remember to not alterate any table name or column name and maintain their format.
        Here are the relevant tables: 
        Transactions Table
            TransactionID: A unique identifier for each transaction (Primary Key).
            UserID: The identifier for the user who made the transaction, linking to the Users table (Foreign Key).
            ProductID: The identifier for the product involved in the transaction, linking to the Products table (Foreign Key).
            Quantity: The number of products purchased in the transaction.
            Price: The price of the product at the time of the transaction.
            Date: The date and time when the transaction took place.
            PaymentMethod: The method of payment used (e.g., credit card, PayPal, etc.).

        Users Table
            UserID: A unique identifier for each user (Primary Key).
            FirstName: The first name of the user.
            LastName: The last name of the user.
            Email: The email address of the user.
            SignUpDate: The date when the user created their account.
            LastLogin: The date and time of the user's last login.

        Products Table
            ProductID: A unique identifier for each product (Primary Key).
            ProductName: The name of the product.
            Description: A brief description of the product.
            Price: The current price of the product.
            StockQuantity: The number of units of the product currently in stock.
            Category: The category or type of the product.
        Example: if the user asks for an ordered list of revenue based on user id, try to generate a query like this: select "USER_ID", "NAME", "EMAIL", sum(cast("REVENUE" as numeric)) as total_revenue from "snowflake_OFFER_CHECKOUT" group by "USER_ID", "REVENUE" order by total_revenue desc;`,
        toolFunction: clientAgentFunction,
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
        toolFunction: clientAgentFunction,
      },
    };

    this.graphManager = new GraphManager(createPlanner(strongestModel), agents, createSolver(fasterModel), outputHandler);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    Logger.log('Final result:', finalResult);
  }
}
