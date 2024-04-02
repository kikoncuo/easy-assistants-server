/** @format */

import { WebSocketServer } from "ws";
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
  rewardTool,
  filterTool,
  eventTool,
  tableTool,
  chartTool,
  infoCardTool,
  cardTool,
  sqlQuery,
  segmentTool,
} from "./tools";
class GraphApplication {
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
        agent: createAgent(haiku, [calculatorTool]),
        agentPrompt:
          "You are an LLM specialized on math operations with access to a calculator tool.",
      },
      createCampaign: {
        agent: createAgent(strongestModel, [
          emailTool,
          rewardTool,
          filterTool,
          eventTool,
          sqlQuery,
        ]),
        agentPrompt: `You are an LLM specialized on creating campaings, in order to create a campaing you will need to call all your tools once to get all the components of a campaign. 
          When using createEmail, generate a summarize text based on the campaign request. When using createFilter, for the age value, check for a comparison type (<x, >x, =, =<, =>, <x>) alongside the value. 
          Category and product can be all, and amount can be any. If asked for a specific product, the createSQLquery tool should be used to fetch the product id and return in into the createFilter object, otherwise the createSQLquery from the sqlQuery tool should not be triggered.
          If no event if indicated for the campaign to be triggered, use Login as a event starter.
          Even if a table column's definition is passed as input, the only table to be filtered is products and the only input for the query should be the name, returning the id of the product.`,
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
        agent: createAgent(haiku, [tableTool]),
        agentPrompt: `You are an LLM specialized in the entire process of transforming JSON data into a fully functional PostgreSQL. This is done by using your createTableStructure tool to create the table. This should return the column name followed by the data type of that column.
          The response should always have this structure and include the columns names and types like in this example: 
          arguments: {
            columns: ["[Column ind, Column text, Column date, Column boolean]"],
            tableName: "my_table",
          },
          Column names should never include whitespaces, but rather underscore for separating works.`,
      },
      createChart: {
        agent: createAgent(haiku, [chartTool]),
        agentPrompt: `You are an LLM specialized in generating chart data from JSON arrays. Based on the input data, you determine the most suitable chart type (bar, line, doughnut) or adhere to a specific type if provided. You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.
          The response should always include the labels property and the data property like this example: 
          arguments: {
            labels: [ "Label, Label, Label, Label" ],
            data: [ "1, 2, 3, 4" ],
            chartType: "bar",
          }.`,
      },
      createInfoCards: {
        agent: createAgent(haiku, [infoCardTool]),
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
        agent: createAgent(haiku, [sqlQuery, segmentTool]),
        agentPrompt: `You are an LLM specialized in generating sql queries based on the input text. The sql query will be used to filter database tables. The user will provide the table's columns definition so the query is based on that information. If the user doesn't provide table's columns definition, for general questions related to user's performance or analysis, the tables
        'transactions' [
           {
               "column_name": "product_id",
               "data_type": "bigint"
           },
           {
               "column_name": "created_at",
               "data_type": "timestamp with time zone"
           },
           {
               "column_name": "category",
               "data_type": "bigint"
           },
           {
               "column_name": "id",
               "data_type": "bigint"
           },
           {
               "column_name": "item_count",
               "data_type": "bigint"
           },
           {
               "column_name": "time",
               "data_type": "timestamp with time zone"
           },
           {
               "column_name": "price",
               "data_type": "double precision"
           },
           {
               "column_name": "member_id",
               "data_type": "uuid"
           },
           {
               "column_name": "name",
               "data_type": "text"
           },
           {
               "column_name": "member_name",
               "data_type": "text"
           }
       ]
       
       and 'products' 
       [
         {
             "column_name": "id",
             "data_type": "bigint"
         },
         {
             "column_name": "created_at",
             "data_type": "timestamp with time zone"
         },
         {
             "column_name": "price",
             "data_type": "double precision"
         },
         {
             "column_name": "name",
             "data_type": "text"
         },
         {
             "column_name": "image",
             "data_type": "text"
         },
         {
             "column_name": "category_name",
             "data_type": "text"
         }
       ]
       
       and knowing that all user's personal information comes from this 
       'related_users' table 
       [
         {
             "column_name": "id",
             "data_type": "uuid"
         },
         {
             "column_name": "updated_at",
             "data_type": "timestamp with time zone"
         },
         {
             "column_name": "loyalty_member",
             "data_type": "boolean"
         },
         {
             "column_name": "join_date",
             "data_type": "date"
         },
         {
             "column_name": "points",
             "data_type": "bigint"
         },
         {
             "column_name": "total_transactions",
             "data_type": "bigint"
         },
         {
             "column_name": "points_redeem",
             "data_type": "bigint"
         },
         {
             "column_name": "activated_campaigns",
             "data_type": "bigint"
         },
         {
             "column_name": "purchase_amount",
             "data_type": "double precision"
         },
         {
             "column_name": "age",
             "data_type": "bigint"
         },
         {
             "column_name": "tier",
             "data_type": "bigint"
         },
         {
             "column_name": "birthdate",
             "data_type": "date"
         },
         {
             "column_name": "postal_code",
             "data_type": "integer"
         },
         {
             "column_name": "related_application",
             "data_type": "uuid"
         },
         {
             "column_name": "job_title",
             "data_type": "text"
         },
         {
             "column_name": "gender",
             "data_type": "text"
         },
         {
             "column_name": "company",
             "data_type": "text"
         },
         {
             "column_name": "user_access",
             "data_type": "text"
         },
         {
             "column_name": "username",
             "data_type": "text"
         },
         {
             "column_name": "full_name",
             "data_type": "text"
         },
         {
             "column_name": "avatar_url",
             "data_type": "text"
         },
         {
             "column_name": "mobile",
             "data_type": "text"
         },
         {
             "column_name": "first_name",
             "data_type": "text"
         },
         {
             "column_name": "email",
             "data_type": "text"
         },
         {
             "column_name": "last_name",
             "data_type": "text"
         },
         {
             "column_name": "city",
             "data_type": "text"
         },
         {
             "column_name": "profile_picture",
             "data_type": "text"
         },
         {
             "column_name": "country",
             "data_type": "text"
         },
         {
             "column_name": "status",
             "data_type": "text"
         },
         {
             "column_name": "address",
             "data_type": "text"
         }
       ]
       should be used,  so this information should be used to generate the SQL queries in order to responde the questions. This should return 2 queries, one with the results of the select part based on the user's input and also a query to create a table with a generated definition based on the result, so the first results of the query can be inserted. The table name and column names should be related to the first query.
       The addSegment from the segmentTool will be used to after the previous queries, so the table name used in the CREATE TABLE statement, will be used in the addSegment in the table_name property.`,
      },
      createCardSQLquery: {
        agent: createAgent(strongestModel, [infoCardTool]),
        agentPrompt: `You are an LLM specialized in generating sql queries based on the input text. The sql query will be used to filter database tables. The user will provide the table's columns definition so the query is based on that information. If the user doesn't provide table's columns definition, for general questions related to user's performance or analysis, the tables
        'transactions' [
           {
               "column_name": "product_id",
               "data_type": "bigint"
           },
           {
               "column_name": "created_at",
               "data_type": "timestamp with time zone"
           },
           {
               "column_name": "category",
               "data_type": "bigint"
           },
           {
               "column_name": "id",
               "data_type": "bigint"
           },
           {
               "column_name": "item_count",
               "data_type": "bigint"
           },
           {
               "column_name": "time",
               "data_type": "timestamp with time zone"
           },
           {
               "column_name": "price",
               "data_type": "double precision"
           },
           {
               "column_name": "member_id",
               "data_type": "uuid"
           },
           {
               "column_name": "name",
               "data_type": "text"
           },
           {
               "column_name": "member_name",
               "data_type": "text"
           }
       ]
       
       and 'products' 
       [
         {
             "column_name": "id",
             "data_type": "bigint"
         },
         {
             "column_name": "created_at",
             "data_type": "timestamp with time zone"
         },
         {
             "column_name": "price",
             "data_type": "double precision"
         },
         {
             "column_name": "name",
             "data_type": "text"
         },
         {
             "column_name": "image",
             "data_type": "text"
         },
         {
             "column_name": "category_name",
             "data_type": "text"
         }
       ]
       
       and knowing that all user's personal information comes from this 
       'related_users' table 
       [
         {
             "column_name": "id",
             "data_type": "uuid"
         },
         {
             "column_name": "updated_at",
             "data_type": "timestamp with time zone"
         },
         {
             "column_name": "loyalty_member",
             "data_type": "boolean"
         },
         {
             "column_name": "join_date",
             "data_type": "date"
         },
         {
             "column_name": "points",
             "data_type": "bigint"
         },
         {
             "column_name": "total_transactions",
             "data_type": "bigint"
         },
         {
             "column_name": "points_redeem",
             "data_type": "bigint"
         },
         {
             "column_name": "activated_campaigns",
             "data_type": "bigint"
         },
         {
             "column_name": "purchase_amount",
             "data_type": "double precision"
         },
         {
             "column_name": "age",
             "data_type": "bigint"
         },
         {
             "column_name": "tier",
             "data_type": "bigint"
         },
         {
             "column_name": "birthdate",
             "data_type": "date"
         },
         {
             "column_name": "postal_code",
             "data_type": "integer"
         },
         {
             "column_name": "related_application",
             "data_type": "uuid"
         },
         {
             "column_name": "job_title",
             "data_type": "text"
         },
         {
             "column_name": "gender",
             "data_type": "text"
         },
         {
             "column_name": "company",
             "data_type": "text"
         },
         {
             "column_name": "user_access",
             "data_type": "text"
         },
         {
             "column_name": "username",
             "data_type": "text"
         },
         {
             "column_name": "full_name",
             "data_type": "text"
         },
         {
             "column_name": "avatar_url",
             "data_type": "text"
         },
         {
             "column_name": "mobile",
             "data_type": "text"
         },
         {
             "column_name": "first_name",
             "data_type": "text"
         },
         {
             "column_name": "email",
             "data_type": "text"
         },
         {
             "column_name": "last_name",
             "data_type": "text"
         },
         {
             "column_name": "city",
             "data_type": "text"
         },
         {
             "column_name": "profile_picture",
             "data_type": "text"
         },
         {
             "column_name": "country",
             "data_type": "text"
         },
         {
             "column_name": "status",
             "data_type": "text"
         },
         {
             "column_name": "address",
             "data_type": "text"
         }
       ]
       should be used, so this information will be used to generate the SQL queries in order to responde the questions. This should return as many queries as will be used to fetch data and populate a card.
       The response should always have this structure like in this example: 
          arguments: {
            [{title: "Test", data: sql query returning only 1 value (the name of the property containing the value should always be called 'count'), percentage: string}, {title: "Test", data:  sql query returning only 1 value (the name of the property containing the value should always be called 'count'), percentage: string}, {title: "Test", data:  sql query returning only 1 value (the name of the property containing the value should always be called 'count'), percentage: string}, etc]
          },`,
      },
      addSegment: {
        agent: createAgent(haiku, [segmentTool]),
        agentPrompt: `You are an LLM specialized in generating sql queries based on the input text. The sql query will be used to insert a new row into the segments table.`,
      },
    };
    this.graphManager = new GraphManager(
      haiku,
      agents,
      haiku,
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
const customOutputHandler = (type: string, message: string, ws: WebSocket) => {
  console.log(`${type}: ${message}`);
  ws.send(JSON.stringify({ type, message }));
};
const queryUser = async (
  type: string,
  functions: Array<{ function_name: string; arguments: any }>,
  ws: WebSocket
) => {
  //console.log(`Querying user for ${type} with functions:`, functions);
  ws.send(JSON.stringify({ type: type, functions }));
  // return new Promise<{ [key: string]: string }>((resolve) => {
  //   const responses: { [key: string]: string } = {};
  //   ws.on("message", (message: string) => {
  //     const data = JSON.parse(message);
  //     if (data.type === "toolResponse") {
  //       responses[data.function_name] = data.response;
  //       if (Object.keys(responses).length === functions.length) {
  //         resolve(responses);
  //       }
  //     }
  //   });
  // });
  return new Promise<{ [key: string]: string }>((resolve) => {
    const responses: { [key: string]: string } = {};
    ws.on("message", (message: string) => {
      const data = JSON.parse(message);
      console.log("🚀 ~ ws.on ~ data:", data);

      if (data.type === "toolResponse") {
        // Assuming data.response is a stringified JSON array of responses
        const toolResponses = data.response;
        toolResponses.forEach(
          (toolResponse: { function_name: string; response: string }) => {
            // Accumulate responses based on function_name
            responses[toolResponse.function_name] =
              toolResponse.response.trim(); // trim() to remove carriage returns or any whitespace
          }
        );
        // Check if all responses have been received
        if (Object.keys(responses).length === functions.length) {
          resolve(responses);
        }
      }
    });
  });
};
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => {
  console.log("Client connected");
  const graphApp = new GraphApplication(
    (type: string, message: string) => customOutputHandler(type, message, ws),
    (
      type: string,
      functions: Array<{ function_name: string; arguments: any }>
    ) => queryUser(type, functions, ws)
  );
  ws.on("message", async (message: string) => {
    const data = JSON.parse(message);
    if (data.type === "query") {
      console.log("Processing task:", data.task);
      await graphApp.processTask(data.task, ws);
    }
  });
  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
console.log("WebSocket server is running on port 8080");
