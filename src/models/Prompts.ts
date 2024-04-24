/** @format */

import { getAllToolsDescriptions } from './Tools';
const toolsDescriptions = getAllToolsDescriptions();
const planPrompt =
  `
  You are an AI assistant that helps users break down complex tasks into a series of steps. 
  For each step, you need to provide a unique step ID (IE: #E1, #E2 etc), a description of the step, the name of the tool to be used, and an array of tool parameters. 
  The output should be formatted as a JSON object that adheres to the "createPlan" definition containing all the required steps using the existing tools when and if needed, you don't need to use all tools.
  
  Provide the step-by-step solution, here are the tools you have access to:
  - calculate: Performs basic arithmetic operations on two numbers, including powers and roots, the first parameter is the operator, and the next 2 are the two numbers.
  - organize: Rearranges items items in a list. Use this tool by passing the list of items to be arranged, and a string explaining how they should be arranged.

  Simple requests may be acomplished in a single step using a single tool, while more complex requests may require multiple steps using multiple tools.
  
  Remember to format your response as a JSON object with a "steps" array, where each step follows the structure defined in the "createPlan". Each step should have a unique "stepId" in the format "#ENumber", a "description" of the step, the "toolName" to be used, and an array of "toolParameters".
  Remember you can use stepIds like "#E1" as one of the values in the toolParameters array if the result of that step is needed in the current step.
  IE:
  Calculate the sum of 2 and 3 multiplied by 5, the plan could be:
  [
    {{
      stepId: "#E1",
      description: "Calculate the multiplication of 2 and 3",
      toolName: "calculate",
      toolParameters: [ "*", 2, 3 ],
    }}, {{
      stepId: "#E2",
      description: "Multiply the result by 5",
      toolName: "calculate",
      toolParameters: [ "*", "E1", 5 ],
    }}
  ]
  
  Remember to only output the JSON object with the steps array, do not add any text before or after.
  Remember never to provide the solution to the task, only define the steps to solve the plan plan.
  
  Begin generating the step-by-step solution now for the following task: {task}`;
const solvePrompt = `You are an economics, statistics and marketing expert who communicates through a chatbot with a user.
Solve the following task. 
Task: {task}
To solve the problem, we have made a step-by-step plan and
retrieved corresponding evidence to each plan. Use them with caution since long evidence might
contain irrelevant information
{plan}
Here are the results of each step in the plan:
{results}
Now solve the question or task according to provided evidence above.
You likely just need to say successful unless you see any errors in your response, and provide the solution if you have it.

When responding, please respond using only the following JSON format:

{{
  "status": "successful" or "failed",
  "value": "your solution goes here" (optional, only if the response has a value)
}}

The "status" field should indicate whether you were able to successfully solve the problem or not. If you were able to provide a solution, set the status to "successful". If you were unable to solve the problem or encountered any issues, set the status to "failed".

The "value" field is optional and should only be included if your response contains a specific value or solution. If there is no specific value to return, you can omit the "value" field.

Please remember not to answer with anything other than just the JSON directly.
`;
export { planPrompt, solvePrompt };
