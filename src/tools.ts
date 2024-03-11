import { ToolDefinition } from "@langchain/core/language_models/base";

const calculatorTool: ToolDefinition = {
    type: "function",
    function: {
      name: "calculate",
      description: "Perform basic arithmetic operations on two numbers, including powers and roots",
      parameters: {
        type: "object",
        properties: {
          a: {
            type: "number",
            description: "The first operand",
          },
          b: {
            type: "number",
            description: "The second operand (For roots, this is the degree of the root)",
          },
          operator: {
            type: "string",
            enum: ["add", "subtract", "multiply", "divide", "power", "root"],
            description: "The arithmetic operation to perform. For 'power', 'a' is raised to the power of 'b'. For 'root', it calculates the 'b'th root of 'a'.",
          },
        },
        required: ["a", "b", "operator"],
      },
    },
  };

const calculatorToolPlannerDescription = "calculate[operation] Perform basic arithmetic operations on two numbers, including powers and roots";

const emailTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createEmailTemplate",
    description: "Creates an email for a campaign based on the template_name, the subject and message",
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
      required: ["template_name", "subject", "message"]
    }
  }
};

const eventTool: ToolDefinition = {
  type: "function",
  function: {
    name: "createEvent",
    description: "Creates an event trigger for a campaign based on specified type and value",
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
            "SocialLikePicture"
          ],
          description: "Event type details"
        },
        eventValue: {
          type: "string",
          description: "The specific event"
        }
      },
      required: ["eventType", "eventValue"]
    }
  }
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
                description: "Filter properties"
              },
              details: {
                type: "object",
                additionalProperties: true,
                description: "Details of the criterion, structure depends on criterionType"
              }
            },
            required: ["criterionType", "details"]
          }
        }
      },
      required: ["criteria"]
    }
  }
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
          description: "Type of reward (coupon, product, or points)"
        },
        amount: {
          type: "string",
          enum: ["discount", "fixedAmount"],
          description: "Fixed amount or discount percentage"
        },
        validity: {
          type: "object",
          properties: {
            start: {
              type: "string",
              format: "date",
              description: "Start date of the reward's validity"
            },
            end: {
              type: "string",
              format: "date",
              description: "End date of the reward's validity"
            }
          },
          required: ["start", "end"]
        }
      },
      required: ["rewardType", "amount", "validity"]
    }
  }
};

const campaginCreatorDescription = "createCampaing[campaing requirements] Description of the campaign requirements, it returns true if the campaign is created successfully, otherwise it returns false"; // TODO: improve this explaining the required fields and update the prommpt example


const toolsDescriptions = [calculatorToolPlannerDescription, campaginCreatorDescription];


function getAllToolsDescriptions() {
  return toolsDescriptions;
}
  
  export { calculatorTool, emailTool, eventTool, filterTool, rewardTool, getAllToolsDescriptions };