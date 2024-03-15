/** @format */

import { ToolDefinition } from "@langchain/core/language_models/base";

const calculatorTool: ToolDefinition = {
  type: "function",
  function: {
    name: "calculate",
    description:
      "Perform basic arithmetic operations on two numbers, including powers and roots",
    parameters: {
      type: "object",
      properties: {
        a: {
          type: "number",
          description: "The first operand",
        },
        b: {
          type: "number",
          description:
            "The second operand (For roots, this is the degree of the root)",
        },
        operator: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide", "power", "root"],
          description:
            "The arithmetic operation to perform. For 'power', 'a' is raised to the power of 'b'. For 'root', it calculates the 'b'th root of 'a'.",
        },
      },
      required: ["a", "b", "operator"],
    },
  },
};

const calculatorToolPlannerDescription =
  "calculate[operation] Perform basic arithmetic operations on two numbers, including powers and roots";

const emailTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createEmailTemplate",
    description:
      "Creates an email for a campaign based on the template_name, the subject and message",
    parameters: {
      type: "object",
      properties: {
        template_name: {
          type: "string",
          description: "Name of the email template",
        },
        subject: {
          type: "string",
          description: "Subject of the email",
        },
        message: {
          type: "string",
          description: "Body of the email to be sent",
        },
      },
      required: ["template_name", "subject", "message"],
    },
  },
};

const eventTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createEvent",
    description:
      "Creates an event trigger for a campaign based on specified type and value",
    parameters: {
      type: "object",
      properties: {
        eventType: {
          type: "string",
          enum: [
            "Date",
            "Login",
            "WebsiteView",
            "SubscribeNewsletter",
            "NewsletterClick",
            "ProductReturn",
            "ProductBasket",
            "Purchase",
            "SocialFollow",
            "SocialComment",
            "SocialPostHashtag",
            "SocialSharePost",
            "SocialLikePicture",
          ],
          description: "Event type details",
        },
        eventValue: {
          type: "string",
          description: "The specific event",
        },
      },
      required: ["eventType", "eventValue"],
    },
  },
};

const filterTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createFilter",
    description: "Sets filter criteria for a marketing campaign",
    parameters: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          description: "List of filter criteria",
          items: {
            type: "object",
            enum: ["age", "purchaseAmount", "gender"],
            properties: {
              criterionType: {
                type: "string",
                description: "Filter properties",
              },
              details: {
                type: "object",
                additionalProperties: true,
                description:
                  "Details of the criterion, structure depends on criterionType",
              },
            },
            required: ["criterionType", "details"],
          },
        },
      },
      required: ["criteria"],
    },
  },
};

const rewardTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createReward",
    description: "Creates a reward for a marketing campaign",
    parameters: {
      type: "object",
      properties: {
        rewardType: {
          type: "string",
          enum: ["coupon", "product", "points"],
          description: "Type of reward (coupon, product, or points)",
        },
        amount: {
          type: "string",
          enum: ["discount", "fixedAmount"],
          description: "Fixed amount or discount percentage",
        },
        validity: {
          type: "object",
          properties: {
            start: {
              type: "string",
              format: "date",
              description: "Start date of the reward's validity",
            },
            end: {
              type: "string",
              format: "date",
              description: "End date of the reward's validity",
            },
          },
          required: ["start", "end"],
        },
      },
      required: ["rewardType", "amount", "validity"],
    },
  },
};

const tableTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createTable",
    description:
      "Generates a PostgreSQL CREATE TABLE statement from a JSON array representing CSV data. The tool infers and returns the data types for each column, based on the json provided. The result will be returned in this format for the headers: column_name type (int, text, etc), column_name2 type (int, text, etc), and the table name as a string. Don't respond until you have the type of the column following the column name.",
    parameters: {
      type: "object",
      properties: {
        columns: {
          type: "array",
          description:
            "The JSON array as a string, representing the column headers. The data types are to be shouwn after each column header name.",
          items: {
            type: "string",
          },
        },
        tableName: {
          type: "string",
          description:
            "The name of the table to be created, without schema prefix.",
        },
      },
      required: ["columns", "tableName"],
    },
  },
};

const tableData: ToolDefinition = {
  type: "function",
  function: {
    name: "insertData",
    description:
      "Prepares data for insertion into a database table by transforming a JSON array into an array of objects. Each object represents a row, with keys matching column names and values corresponding to the data to be inserted. This format is ideal for bulk insert operations in databases like Supabase, facilitating easy data import from JSON sources.",
    parameters: {
      type: "object",
      properties: {
        data_rows: {
          type: "array",
          description:
            "The JSON array as a string. Each element of the array should represent a row of data to be inserted into the table.",
          items: {
            type: "string",
          },
        },
      },
      required: ["data_rows"],
    },
  },
};

const chartTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createChart",
    description:
      "This function extracts data from a provided JSON array to create two arrays: one for chart labels ('labels') and another for the corresponding values ('values'), suitable for chart generation. The chart type (bar, line, doughnut) can be specified; if not, or if 'auto' is selected, the function determines the most appropriate chart type based on the data. The response will be structured as an object with two keys, 'labels' and 'values', each containing an array of strings for labels and an array of numbers for values, respectively, ensuring easy integration with JavaScript charting components.",
    parameters: {
      type: "object",
      properties: {
        jsonData: {
          type: "string",
          description:
            "The JSON array as a string, representing the data rows from which chart data will be extracted.",
        },
        dataDescription: {
          type: "string",
          description:
            "A description of the data to extract for 'labels' and 'values'.",
        },
        chartType: {
          type: "string",
          enum: ["bar", "line", "doughnut", "auto"],
          default: "auto",
          description:
            "Specifies the chart type. If 'auto' or not specified, the chart type is determined based on the input data.",
        },
      },
      required: ["jsonData", "dataDescription"],
    },
  },
};

const campaginCreatorDescription =
  "createCampaing[campaing requirements] Description of the campaign requirements, it returns true if the campaign is created successfully, otherwise it returns false"; // TODO: improve this explaining the required fields and update the prommpt example

const createTableDescription =
  "createTable[jsonData, tableName] Generates a PostgreSQL CREATE TABLE statement and corresponding INSERT statements based on a provided JSON array. It automatically identifies column types and sanitizes data to ensure consistency and uniqueness. The table name is specified without any schema prefix.";

const createChartDescription =
  "createChart[jsonData, dataDescription, chartType] Extracts data from a JSON array to create arrays for chart labels and values. If the chart type is not specified, it determines the most suitable chart type ('bar', 'line', 'doughnut') based on the data characteristics. Designed for easy integration with JavaScript charting components.";

const toolsDescriptions = [
  calculatorToolPlannerDescription,
  campaginCreatorDescription,
  createTableDescription,
  createChartDescription,
];

function getAllToolsDescriptions() {
  return toolsDescriptions;
}

export {
  calculatorTool,
  emailTool,
  eventTool,
  filterTool,
  rewardTool,
  tableTool,
  tableData,
  chartTool,
  getAllToolsDescriptions,
};
