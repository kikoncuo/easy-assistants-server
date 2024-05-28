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
  filterData,
  dataRetriever,
  generateInsight,
  shippingAlertAgent,
  triggerNotification
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
      dataRetriever: {
        agent: createAgent(strongestModel, [dataRetriever], true),
        agentPrompt: `You are an LLM specialized in retrieving data from database using sql queries. Your task is to efficiently gather relevant data based on the user's inputs. Utilize your expertise to collect the necessary information while considering data accuracy and completeness.
       Example: if the user asks for insights about product Planes, try to generate a query like this: select "id", "name", "price", "features" from "products" where "name" like '%Planes%';`,
       toolFunction: clientAgentFunction,
      },
      generateInsight: {
        agent: createAgent(strongestModel, [generateInsight], true),
        agentPrompt: `You are an LLM specialized in generating insights based on the provided data. Analyze the provided dataset to identify significant patterns, trends, and actionable insights. Generate clear and concise recommendations to help business teams make informed decisions. Focus on highlighting key performance indicators, customer insights, market trends, and operational efficiencies, and present findings in an easy-to-understand format.`,
        toolFunction: clientAgentFunction,
      },
      shippingAlertAgent: {
        agent: createAgent(strongestModel, [shippingAlertAgent], true),
        agentPrompt: `You are an LLM specialized in generating cron expressions and SQL queries for scheduling alerts. Your task is to create the necessary cron expressions, SQL queries, and other relevant information based on user inputs for alerting when products require shipping.
        Example: if the user says 'Alert me whenever products require shipping, every 2 minutes', generate the following:
        {
          "cron_time": "*/2 * * * *",
          "sql_query": "SELECT name FROM notifications.products WHERE shipping_required = true",
          "condition": "COUNT(*) > 0",
          "message": "These products need to be shipped.",
          "type": "alert",
          "description": "Sends an alert when products require shipping."
        }`,
        toolFunction: clientAgentFunction,
      },
      triggerNotification: {
        agent: createAgent(strongestModel, [triggerNotification], true),
        agentPrompt:`You are an LLM specialized in generating SQL queries for based on the provided data. Your task is to create SQL queries to insert data to the notification_triggers table.
        Example: if get data like this:
        {
          "cron_time": "*/2 * * * *",
          "sql_query": "SELECT name FROM notifications.products WHERE shipping_required = true",
          "condition": "COUNT(*) > 0",
          "message": "These products need to be shipped.",
          "type": "alert",
          "description": "Sends an alert when products require shipping."
        }, 
        Then generate sql query like this:
        INSERT INTO notifications.notification_triggers (cron_time, sql_query, condition, message, description, type)
        VALUES (
          '*/2 * * * *',
          'SELECT name FROM notifications.products WHERE shipping_required = true',
          'COUNT(*) > 0',
          'These products need to be shipped.',
          'alert',
          'Sends an alert when products require shipping.'
        );`,
        toolFunction: clientAgentFunction,
      }
      // const restockAlertAgent = {
      //   agent: createAgent(strongestModel, [restockAlertAgent], true),
      //   agentPrompt: `You are an LLM specialized in generating SQL queries for inventory management. Your task is to create queries that identify products requiring restocking based on user inputs. Ensure that the queries are accurate and consider the stock levels and reorder thresholds.
      //   Example: if the user says 'alert me when product XYZ needs restocking', generate a query like this: 
      //   INSERT INTO alerts (query, alert_message) VALUES ('SELECT * FROM products WHERE name = ''XYZ'' AND stock < reorder_level', 'Product XYZ needs restocking');`,
      //   toolFunction: storeAlertQuery,
      // };
    };

    this.graphManager = new GraphManager(createPlanner(strongestModel), agents, createSolver(llama70bGroq), outputHandler);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    Logger.log('Final result:', finalResult);
  }
}
