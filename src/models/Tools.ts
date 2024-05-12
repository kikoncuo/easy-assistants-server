/** @format */

import { ToolDefinition } from '@langchain/core/language_models/base';
/* TODO: Double check if we can delete this because we are using structurized output
const planningTool: ToolDefinition = { 
  type: "function",
  function: {
    name: "createPlan",
    description: "Creates an array of steps, where each step is an object containing a step ID, description, tool name, and an array of tool parameters",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "An array of step objects",
          items: {
            type: "object",
            properties: {
              stepId: {
                type: "string",
                pattern: "^#E\\d+$",
                description: "The step ID in the format #ENumber (e.g., #E1, #E2)",
              },
              description: {
                type: "string",
                description: "A description of the step",
              },
              toolName: {
                type: "string",
                description: "The name of the tool to be used in the step",
              },
              toolParameters: {
                type: "array",
                description: "An array of tool parameters, which can include step results",
                items: {
                  type: "string",
                },
              },
            },
            required: ["stepId", "description", "toolName", "toolParameters"],
          },
        },
      },
      required: ["steps"],
    },
  },
};*/

const calculatorTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calculate',
    description: 'Perform basic arithmetic operations on two numbers, including powers and roots',
    parameters: {
      type: 'object',
      properties: {
        a: {
          type: 'number',
          description: 'The first operand',
        },
        b: {
          type: 'number',
          description: 'The second operand (For roots, this is the degree of the root)',
        },
        operator: {
          type: 'string',
          enum: ['add', 'subtract', 'multiply', 'divide', 'power', 'root'],
          description:
            "The arithmetic operation to perform. For 'power', 'a' is raised to the power of 'b'. For 'root', it calculates the 'b'th root of 'a'.",
        },
      },
      required: ['a', 'b', 'operator'],
    },
  },
};

const sqlQuery: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createSQLquery',
    description:
      "Creates a given SQL query with specified parameters and returns the result set.The table's columns definition is provided.",
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description:
            'The SQL query string to be executed. Can include parameters. Never use HAVING statement, but WHERE.',
        },
        sql_insert: {
          type: 'string',
          description:
            "The SQL query string to be executing, containing the CREATE TABLE statement based on the 'sql' property, the table columns definition should be generated based on the desired result input by the user.",
        },
        chart: {
          type: 'boolean',
          description:
            'Indicate if based on the generated query, a chart would be helpful to understand better the data.',
        },
        // params: {
        //   type: "array",
        //   description:
        //     "An array of parameters to be injected into the SQL query. These parameters correspond to placeholders in the 'sql' string.",
        //   items: {
        //     type: "string",
        //     description:
        //       "A parameter value to be safely injected into the SQL query",
        //   },
        // },
      },
      required: ['sql', 'sql_insert', 'chart'],
    },
  },
};

const segmentTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'addSegment',
    description: 'Creates a given SQL query with specified parameters and returns the result set',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the segment',
        },
        created_by: {
          type: 'string',
          description: 'Name of the user that executed the query',
        },
        last_edited: {
          type: 'string',
          description: 'Actual date of the function execution in format YYYY-MM-DD',
        },
        condition: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['age', 'amount', 'gender', 'category', 'product'],
          },
        },
        table_name: {
          type: 'string',
          description: 'Table name that was used to insert data from the createSQLquery function.',
        },
      },
      required: ['name', 'created_by', 'last_edited', 'condition', 'table_name'],
    },
  },
};

const emailTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createEmail',
    description: 'Creates an email for a campaign based on the template_name, the subject and message',
    parameters: {
      type: 'object',
      properties: {
        template_name: {
          type: 'string',
          description: 'Name of the email template',
        },
        subject: {
          type: 'string',
          description: 'Subject of the email',
        },
        message: {
          type: 'string',
          description: 'Body of the email to be sent',
        },
      },
      required: ['template_name', 'subject', 'message'],
    },
  },
};
const eventTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createEvent',
    description: 'Creates an event trigger for a campaign based on specified type and value',
    parameters: {
      type: 'object',
      properties: {
        eventType: {
          type: 'string',
          enum: [
            'Date',
            'Login',
            'WebsiteView',
            'SubscribeNewsletter',
            'NewsletterClick',
            'ProductReturn',
            'ProductBasket',
            'Purchase',
            'SocialFollow',
            'SocialComment',
            'SocialPostHashtag',
            'SocialSharePost',
            'SocialLikePicture',
          ],
          description: 'Event type details',
        },
        eventValue: {
          type: 'string',
          description: 'The specific event',
        },
      },
      required: ['eventType', 'eventValue'],
    },
  },
};
const filterTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createFilter',
    description: 'Sets filter criteria for a marketing campaign',
    parameters: {
      type: 'object',
      properties: {
        criteria: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['age', 'amount', 'gender', 'category', 'product'],
          },
        },
        value: {
          type: 'array',
          items: {
            type: 'string',
          },
          description:
            'An array containing the value of the criteria that are going to be applied to the campaign. For comparison types, use these ones <x, >x, =, =<, =>, <x> as needed.',
        },
      },
      required: ['criteria', 'value'],
    },
  },
};
const rewardTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createReward',
    description:
      'Creates a reward for a marketing campaign, allowing for various reward types including coupons for fixed amounts or percentages, products, or points.',
    parameters: {
      type: 'object',
      properties: {
        rewardType: {
          type: 'string',
          enum: ['coupon', 'product', 'points'],
          description: 'Type of reward (coupon, product, or points)',
        },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['fixedAmount', 'percentage', 'productID', 'points'],
                description:
                  'Specifies the reward detail type: fixed amount, percentage for coupons; product ID for products; or a points value.',
              },
              value: {
                type: 'string',
                description:
                  'The value associated with the reward detail, such as the coupon value, product ID, or points amount.',
              },
            },
            required: ['type', 'value'],
          },
          description: 'An array containing the details of the reward, accommodating various types and values.',
        },
        validity: {
          type: 'object',
          properties: {
            start: {
              type: 'string',
              format: 'date',
              description: "Start date of the reward's validity",
            },
            end: {
              type: 'string',
              format: 'date',
              description: "End date of the reward's validity",
            },
          },
          required: ['start', 'end'],
        },
      },
      required: ['rewardType', 'details', 'validity'],
    },
  },
};

const tableTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createTableStructure',
    description:
      "Generates a PostgreSQL CREATE TABLE statement from a JSON array representing CSV data. The tool infers and returns the data types for each column, based on the json provided. The result will be returned in this format for the headers: column_name type (int, text, etc), column_name2 type (int, text, etc), and the table name as a string. Don't respond until you have the type of the column following the column name.",
    parameters: {
      type: 'object',
      properties: {
        columns: {
          type: 'array',
          description:
            'The columns for the table, representing the column headers. The data types are to be shouwn after each column name.',
          items: {
            type: 'string',
          },
        },
        tableName: {
          type: 'string',
          description: 'The name of the table to be created, without schema prefix.',
        },
      },
      required: ['columns', 'tableName'],
    },
  },
};

const pageHtmlTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'updateHtml',
    description: "Given an html code, returns a different element's organization.",
    parameters: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'The updated html code returned.',
        },
      },
      required: ['html'],
    },
  },
};

const organizeItemTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'organizeItems',
    description: 'An array of items, organize them as the user ask.',
    parameters: {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          description: 'The organized array of elements.',
          items: { type: 'string' },
        },
      },
      required: ['cards'],
    },
  },
};

const chartTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createChart',
    description: 'Generates a chart based on provided labels, data, and chart type',
    parameters: {
      type: 'object',
      properties: {
        labels: {
          type: 'array',
          description: 'The labels for the chart, usually representing the X-axis or categories',
          items: { type: 'string' },
        },
        data: {
          type: 'array',
          description: 'The data points for the chart, corresponding to the labels',
          items: { type: 'number' },
        },
        chartType: {
          type: 'string',
          description: "The type of chart to generate",
        },
        explanation: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title for the explanation.",
            },
            description: {
              type: "string",
              descrption: "Explanation of why that SQL was generated.",
            },
          },
        },
      },
      required: ['labels', 'data', 'chartType', "explanation"],
    },
  },
};

const infoCardTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createInfoCard',
    description: 'Generates a list of objects based on provided input data',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title for the card',
        },
        data: {
          type: 'string',
          description: 'The data points for the card',
        },
        percentage: {
          type: 'string',
          description: 'The percentage value, if exists.',
        },
      },
      required: ['title', 'data', 'percentage'],
    },
  },
};

const cardTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'createCardSQLquery',
    description:
      "Creates a given SQL query with specified parameters and returns the result set.The table's columns definition is provided.",
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description:
            'The SQL query string to be executed. Can include parameters. Never use HAVING statement, but WHERE.',
        },
      },
      required: ['sql'],
    },
  },
};

const getTables: ToolDefinition = {
  type: "function",
  function: {
    name: "getTables",
    description:
      "Given a list of table names, identify those with a possible relation to user's request.",
    parameters: {
      type: "object",
      properties: {
        tables: {
          type: "array",
          description: "The list of selected tables.",
          items: { type: 'string' },
        },
        explanation: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title for the explanation.",
            },
            description: {
              type: "string",
              descrption: "Explanation of why those tables were selected",
            },
          },
        },
      },
      required: ["tables", "explanation"],
    },
  },
};

const filterData: ToolDefinition = {
  type: "function",
  function: {
    name: "filterData",
    description:
      "Given a JSON array, filter it based on user's request.",
    parameters: {
      type: "object",
      properties: {
        users: {
          type: "array",
          description: "The list of selected objects from the array.",
          items: { 
            type: "object",
            properties: {
              email: {
                type: "string",
                description: "User's email.",
              },
              name: {
                type: "string",
                descrption: "User's name",
              },
              recently_engaged: {
                type: "string",
                description: "Boolean indicating if the user is recently engaged.",
              },
              social_media: {
                type: "string",
                descrption: "Social media from which data was collected",
              },
            },
           },
        },
        explanation: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title for the explanation.",
            },
            description: {
              type: "string",
              descrption: "Explanation of why those objects were selected",
            },
          },
        },
      },
      required: ["users", "explanation"],
    },
  },
};


const getData: ToolDefinition = {
  type: "function",
  function: {
    name: "getData",
    description:
      "Given an array of table columns and query description, evaluate them and create an SQL query to match the user's necessities to query the requested data",
    parameters: {
      type: "object",
      properties: {
        sqlQuery: {
          type: "string",
          description:
            `The unique SQL query with all the columns from all the different tables. All column names and tables names, even when using renames, should be in between double commas (I.E.: select name from users, should be select "name" from "users").`,
        },
        sqlTitle: {
          type: "string",
          description:
            "Title that will have the table created with that SQL query.",
        },
        sqlDescription: {
          type: "string",
          description:
            "A simple description giving more context of the sqlTitle text.",
        },
        headers: {
          type: "array",
          description: "The list of headers for the sqlQuery statement.",
          items: { type: 'string' },
        },
        explanation: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title for the explanation.",
            },
            description: {
              type: "string",
              descrption: "Explanation of why that SQL was generated.",
            },
          },
        },
      },
      required: ["sqlQuery", "sqlDescription", "headers", "explanation"],
    },
  },
};


export {
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
  getData,
  filterData,
};
