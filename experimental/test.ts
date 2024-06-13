import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatGroq } from "@langchain/groq";
import { z } from "zod";

const model = new ChatGroq({
  temperature: 0,
  modelName: "llama3-70b-8192",
  streaming: false,
});

const calculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  number1: z.number(),
  number2: z.number(),
});

const StepSchema = z
  .object({
    stepId: z
      .string()
      .regex(/^#E\d+$/)
      .describe('The step ID in the format #ENumber (e.g., #E1, #E2)'),
    description: z.string().min(1).max(1000).describe('A description of the step, should be concise yet informative'),
    toolName: z
      .string()
      .min(1)
      .max(50)
      .describe('The name of the tool to be used in the step, should match one of the available tools'),
    toolParameters: z
      .array(z.string())
      .min(1)
      .max(10)
      .describe('An array of tool parameters, which can include step results or other step IDs'),
  })
  .describe('An object representing a single step in the process');

const planSchema = z
  .object({
    steps: z.array(StepSchema).min(1).max(20).describe('An array of step objects, representing the entire process'),
  })
  .describe('The root object containing the array of steps');



const modelWithStructuredOutput = (model as any).withStructuredOutput(planSchema);

const prompt = ChatPromptTemplate.fromMessages([
  ["human", `You are an AI assistant that helps users break down complex tasks into a series of steps. For each step, you need to provide a unique step ID (e.g., #E1, #E2), a description of the step, the name of the tool to be used, and an array of tool parameters. All parameters must be strings.

  Here are the tools you have access to:
  
      calculate: Performs basic arithmetic operations on two numbers, including powers and roots. The first parameter is the operator, and the next two are the numbers, all values as strings.
      organize: Rearranges items in a list. Use this tool by passing the list of items to be arranged and a string explaining how they should be arranged. Only use this tool if the user explicitly asks you to rearrange something.
      getData: Use this tool exclusively when a user requests the creation of a segment or a table. It requires a description of the data that needs to be retrieved.
      createChart: Use this tool to generate labels, data, and type for chart generation. This tool will have as input a JSON with the complete data that will have to be filtered and provide only the information related to the user's request. The chart type will come indicated in the input message as line, bar, or doughnut; otherwise, use the bar type.
  
  Simple requests may be accomplished in a single step using a single tool, while more complex requests may require multiple steps using multiple tools. You can use step IDs like "#E1" as one of the values in the toolParameters array if the result of that step is needed in the current step. Never provide the solution to the task, only define the steps to solve the plan.
  
  Examples:
  
  Example 1: if the user were to give the task: Calculate the sum of 2 and 3 multiplied by 5
  We would create a plan with 2 steps, #E1 and #E2:
  #E1 would call the calculate tool with parameters ["*", "3", "5"] and describe the step as "Calculate the multiplication of 3 and 5 respecting PEMDAS rules"
  #E2 would call the calculate tool with parameters ["+", "#E1", "2"] and describe the step as "Add 2 to the results"

  Example 2: if the user were to give the task: Create a graph to highlight my top 10 customers last year, my tables are Transactions, Users, and Products
  We would create a plan with 2 steps, #E1 and #E2:
  #E1 would call the getData tool with parameters ["Get the top 10 customers in terms of spent last week"] and describe the step as "Get the top 10 customers in terms of spent last week from the Transactions and Users data"
  #E2 would call the createChart tool with parameters ["#E1"] and describe the step as "Generate a chart to highlight the top 10 customers"
  
  Here is the real task: {task}`]
]);
const chain = prompt.pipe(modelWithStructuredOutput);
const result = await chain.invoke({task:"what's 3*6 divided by 2"});
console.log(result);
