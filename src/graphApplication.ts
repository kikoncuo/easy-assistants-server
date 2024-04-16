/** @format */

import { GraphManager } from "./LangraphReWoo";
import {
  getStrongestModel,
  getFasterModel,
  groqChatMixtral,
  anthropicSonnet,
  anthropicOpus,
  createAgent,
  anthropicHaiku,
} from "./models";
import {
  calculatorTool,
  emailTool,
  eventTool,
  filterTool,
  rewardTool,
  tableTool,
  chartTool,
  infoCardTool,
  cardTool,
  sqlQuery,
  segmentTool,
  pageHtmlTool,
  organizeItemTool,
  getTables,
  getSegmentDetails,
  redirectMessage,
} from "./tools";

export class GraphApplication {
  private graphManager: GraphManager;
  private outputHandler: (type: string, message: string, ws: WebSocket) => void;

  constructor(
    outputHandler: (type: string, message: string) => void = console.log,
    agentFunction: Function
  ) {
    this.outputHandler = outputHandler;
    const haiku = anthropicHaiku();
    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const groqModel = groqChatMixtral();
    const anthropicModel = anthropicSonnet();
    const anthropicAdvancedModel = anthropicOpus();

    const agents = {
      calculate: {
        agent: createAgent(strongestModel, [calculatorTool]),
        agentPrompt:
          "You are an LLM specialized on math operations with access to a calculator tool.",
      },
      getTables: {
        agent: createAgent(strongestModel, [getTables]),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. You are provided with a list of table definitions and your task is to determine the most suitable tables based on the context of the user's needs. Assess the table names to identify the most relevant and useful tables that align with the user's objectives for data analysis, reporting, or application development. Once done, return that list to the user so it can be confirmed..
        When using getTables, return a simple list of table names and wait for user's response before continue. The response for getTables should look like this: 
        {
            function_name: getTables,
            arguments: {
                tables: [transaction, members, purchases],
                explanation: These tables are selected based on all the inputs, because represent the user's purchase connections.
            }
        }.
        You will always give an explanation on why you did that selection.`,
      },
      getSegmentDetails: {
        agent: createAgent(strongestModel, [getSegmentDetails]),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. You will only run if the getTables agent, returned a true. Then, based on that list of table columns that the user will provide, generate the SQL query to adquired the user's needs
        When using getSegmentDetails, return the SQL query for a view creation. The response should look like this: 
        {
            function_name: getSegmentDetails
            arguments: {
                sqlQuery: [sql query statement for the create view]
            }
        }`,
      },
      updateCampaign: {
        agent: createAgent(strongestModel, [
          emailTool,
          rewardTool,
          filterTool,
          eventTool,
          sqlQuery,
        ]),
        agentPrompt: `You are an LLM specialized on updating existing campaings, in order to update a campaing you will need to call the necessary tools once to get all the components of a campaign and update it. 
          When using createEmail, generate a summarize text based on the campaign request. When using createFilter, for the age value, check for a comparison type (<x, >x, =, =<, =>, <x>) alongside the value. 
          Category and product can be all, and amount can be any. If asked for a specific product, the createSQLquery tool should be used to fetch the product id and return in into the createFilter object, otherwise the createSQLquery from the sqlQuery tool should not be triggered.
          If no event if indicated for the campaign to be triggered, use Login as a event starter.
          Even if a table column's definition is passed as input, the only table to be filtered is products and the only input for the query should be the name, returning the id of the product.`,
      },
      createTableStructure: {
        agent: createAgent(strongestModel, [tableTool]),
        agentPrompt: `You are an LLM specialized in the entire process of transforming JSON data into a fully functional PostgreSQL. This is done by using your createTableStructure tool to create the table. This should return the column name followed by the data type of that column.
          The response should always have this structure and include the columns names and types like in this example: 
          arguments: {
            columns: ["[Column ind, Column text, Column date, Column boolean]"],
            tableName: "my_table",
          },
          Column names should never include whitespaces, but rather underscore for separating works.`,
      },
      redirectMessage: {
        agent: createAgent(strongestModel, [redirectMessage]),
        agentPrompt: `You are an LLM specialized sending custom messages based on task required. This tool should always be true in order to continue with next steps. This should always responde with something similar: 
          arguments: {
            message: ["Sure! Let's go to the chart generator to get started."],
          },`,
      },
      createChart: {
        agent: createAgent(strongestModel, [chartTool]),
        agentPrompt: `You are an LLM specialized in generating chart data from JSON arrays. Based on the input data, you determine the most suitable chart type (bar, line, doughnut) or adhere to a specific type if provided. You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.
          The response should always include the labels property and the data property like this example: 
          arguments: {
            labels: [ "Label, Label, Label, Label" ],
            data: [ "1, 2, 3, 4" ],
            chartType: "bar",
          }.`,
      },
      updateHtml: {
        agent: createAgent(strongestModel, [pageHtmlTool]),
        agentPrompt: `You are an LLM specialized in html generation. Based on the input data, you determine the most suitable organization of the items on the input html code and return an updated version with the items organized.
        You are not asked to created new items, just organize them better, either in a specific way asked by the user or by your own logic.
        You will return the whole updated code back to the client so it can be rendered.
        Always responde with a string containing all the updated html code, like this example: 
        arguments: [{
            html: ["<code/>"]
          }],`,
      },
      organizeItems: {
        agent: createAgent(strongestModel, [organizeItemTool]),
        agentPrompt: `You are an LLM specialized in array string modifications. Based on the input data, an array in string format, reorder the items inside the array.
        You are not asked to created new items, but just order them. 
        You will return the same initial items that exist in the string array, but in a different order without altering the values inside.`,
      },
      createInfoCards: {
        agent: createAgent(strongestModel, [infoCardTool]),
        agentPrompt: `You are an LLM specialized in generating information cards data from JSON arrays. You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.
          The response should always include the objects property like this example: 
          arguments: [{
            title: [ "Title" ],
            data: [ "1" ],
            percentage: {exist: true, value: 15},
          },
          {
            title: [ "Title" ],
            data: [ "2" ],
            percentage: {exist: true, value: -11},
          },
          {
            title: [ "Title" ],
            data: [ "3" ],
            percentage: {exist: false, value: 0},
          }].`,
      },
      createSQLquery: {
        agent: createAgent(strongestModel, [sqlQuery]),
        agentPrompt: `You are an LLM specialized in generating sql queries based on the input text. The sql query will be used to filter database tables. The user will provide the table's columns definition so the query is based on that information. If the user doesn't provide table's columns definition, for general questions related to user's performance or analysis, the tables
        
       should be used,  so this information should be used to generate the SQL queries in order to responde the questions. This should return 2 queries, one with the results of the select part based on the user's input and also a query to create a table with a generated definition based on the result, so the first results of the query can be inserted. The table name and column names should be related to the first query.
       The addSegment from the segmentTool will be used to after the previous queries, so the table name used in the CREATE TABLE statement, will be used in the addSegment in the table_name property.`,
      },
      createCardSQLquery: {
        agent: createAgent(strongestModel, [infoCardTool]),
        agentPrompt: `You are an LLM specialized in generating sql queries based on the input text. The sql query will be used to filter database tables. The user will provide the table's columns definition so the query is based on that information. If the user doesn't provide table's columns definition, for general questions related to user's performance or analysis, the tables
        
       should be used, so this information will be used to generate the SQL queries in order to responde the questions. This should return as many queries as will be used to fetch data and populate a card.
       The response should always have this structure like in this example: 
          arguments: {
            [{title: "Test", data: sql query returning only 1 value (the name of the property containing the value should always be called 'count'), percentage: string}, {title: "Test", data:  sql query returning only 1 value (the name of the property containing the value should always be called 'count'), percentage: string}, {title: "Test", data:  sql query returning only 1 value (the name of the property containing the value should always be called 'count'), percentage: string}, etc]
          },`,
      },
    };

    this.graphManager = new GraphManager(
      strongestModel,
      agents,
      strongestModel,
      outputHandler,
      agentFunction
    );
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    if (finalResult) {
      this.outputHandler("result", finalResult.result, ws);
    }
  }
}

// This function is called when the agent answers a message, Currently it just sends it to the user via the WS
export const customOutputHandler = (
  type: string,
  message: string,
  ws: WebSocket
) => {
  console.log(`${type}: ${message}`);
  ws.send(JSON.stringify({ type, message }));
};

// This function is called when the agent needs to query the user to get the answer of a tool, Currently it just sends it to the user via the WS and expects a response
export const queryUser = async (
  type: string,
  functions: Array<{ function_name: string; arguments: any }>,
  ws: WebSocket
) => {
  ws.send(JSON.stringify({ type: type, functions }));
  return new Promise<{ [key: string]: string }>((resolve) => {
    const responses: { [key: string]: string } = {};
    ws.on("message", (message: string) => {
      const data = JSON.parse(message);
      console.log("🚀 ~ ws.on ~ data:", data);

      if (data.type === "toolResponse") {
        const toolResponses = data.response;
        if (Array.isArray(toolResponses)) {
          toolResponses.forEach((toolResponse) => {
            responses[toolResponse.function_name] = toolResponse.response;
          });
        } else {
          responses[toolResponses.function_name] = toolResponses.response;
        }

        if (Object.keys(responses).length === functions.length) {
          resolve(responses);
        }
      }
    });
  });
};
