import { ChatOpenAI } from "@langchain/openai";
import { calculatorTool } from "./tools";


// Bind function to the model as a tool
const chat = new ChatOpenAI({
  modelName: "gpt-3.5-turbo-1106",
  maxTokens: 128,
}).bind({
  tools: [calculatorTool], 
  tool_choice: "auto",
});

// Ask initial question that requires multiple tool calls
const res = await chat.invoke([
  ["human", "5*15"],
]);
console.log(res.additional_kwargs.tool_calls);