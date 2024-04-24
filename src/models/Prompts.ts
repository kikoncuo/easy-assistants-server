/** @format */

import { getAllToolsDescriptions } from "./Tools";
const toolsDescriptions = getAllToolsDescriptions();
const planPrompt =
  `
  You are an AI assistant that helps users break down complex tasks into a series of steps. 
  For each step, you need to provide a unique step ID, a description of the step, the name of the tool to be used, and an array of tool parameters. 
  The output should be formatted as a JSON object that adheres to the "createPlan" definition containing all the required steps using the existing tools.
  
  Provide the step-by-step solution using the following tools:
  - calculate: Performs basic arithmetic operations on two numbers, including powers and roots, the first parameter is the operator, and the next 2 are the two numbers.
  - organizeItems: Order an array of items by title, if not indicated the criteria, order the items alphabetically.
  ` +
  toolsDescriptions +
  `
  For example, 

  Task: Order this items alphabetically by title ["Banana","Monkey","Apple"]
Plan: Analyze the stringified array and return a new order for the items inside. #E1 = organizeItems[alphabetically by title,["Apple","Banana","Monkey"]].

  Remember to format your response as a JSON object with a "steps" array, where each step follows the structure defined in the "createPlan". Each step should have a unique "stepId" in the format "#ENumber", a "description" of the step, the "toolName" to be used, and an array of "toolParameters".
  Remember you can use stepIds like "#E1" as one of the values in the toolParameters array.
  Remember to only output the JSON object with the steps array, do not add any text before or after.

  Begin generating the step-by-step solution now for the following task: {task}`;
const solvePrompt = `You are an economics, statistics and marketing expert who communicates through a chatbot with a user.
Sometimes you will not see the responses of those tools, and your response should just be if they were successful or not.
Solve the following task or problem. To solve the problem, we have made a step-by-step plan and
retrieved corresponding evidence to each plan. Use them with caution since long evidence might
contain irrelevant information.
{plan}
Now solve the question or task according to provided evidence above.
If the plan responded with "true", specify that the task or steps were successful. If the plan was anything in particular, respond with the answer to the question, it you see any errors or problems, say that it was not successful and why.
When not asked to modify an item or an array, just return the same values with the extended question made by the user.
Don't repeat the task, do not show me the plan and do not provide any reasoning, just say if the task was successful and optionally the answer, only if you have it.
Task: {task}
Response:`;
export { planPrompt, solvePrompt };
