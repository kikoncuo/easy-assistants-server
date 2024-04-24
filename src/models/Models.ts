/** @format */

// models.ts
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { ChatGroq } from '@langchain/groq';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Runnable } from 'langchain/runnables';
import type { BaseLanguageModelCallOptions, ToolDefinition } from '@langchain/core/language_models/base';
import { z } from 'zod';

const StepSchema = z
  .object({
    stepId: z
      .string()
      .regex(/^#E\d+$/)
      .describe('The step ID in the format #ENumber (e.g., #E1, #E2)'),
    description: z.string().min(1).max(100).describe('A description of the step, should be concise yet informative'),
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

const solverSchema = z.object({
  status: z.enum(['successful', 'failed']).describe('The status of the solver, either successful or failed'),
  explanation: z.string().optional().describe('Explanation of the status and value'),
  value: z.string().optional().describe('The optional, final, concise, value returned to the user if the response has a value.'),
});

export interface ChatToolsCallOptions extends BaseLanguageModelCallOptions {
  tools?: ToolDefinition[];
  tool_choice?:
    | 'auto'
    | {
        function: {
          name: string;
        };
        type: 'function';
      };
}

// Helper functions:
function createPlanner(llm: BaseChatModel<ChatToolsCallOptions>): Runnable {
  const bindedLLM = llm.withStructuredOutput ? llm.withStructuredOutput(planSchema) : llm;
  return bindedLLM;
}

function createSolver(llm: BaseChatModel<ChatToolsCallOptions>): Runnable {
  const bindedLLM = llm.withStructuredOutput ? llm.withStructuredOutput(solverSchema) : llm;
  return bindedLLM;
}

function createAgent(llm: BaseChatModel<ChatToolsCallOptions>, tools: ToolDefinition[], forceTool: boolean = false): Runnable { // TODO: add support for agents who perform the task themselves without querying the frontend for the result
  const bindedLLM = llm.bind({
    tools: tools,
    tool_choice: forceTool ? tools[0] : 'auto',
  });

  return bindedLLM;
}

// Models:
function getStrongestModel(): BaseChatModel {
  return new ChatOpenAI({
    modelName: 'gpt-4-turbo-preview',
    streaming: false,
    temperature: 0,
  });
}

function getFasterModel(): BaseChatModel {
  return new ChatOpenAI({
    modelName: 'gpt-3.5-turbo',
    streaming: false,
    temperature: 0,
  });
}

function groqChatMixtral(): BaseChatModel {
  return new ChatGroq({
    temperature: 0,
    modelName: 'mixtral-8x7b-32768',
    streaming: false,
  });
}

function groqChatLlama(): BaseChatModel {
  return new ChatGroq({
    temperature: 0,
    modelName: 'llama3-70b-8192',
    streaming: false,
  });
}

function groqChatSmallLlama(): BaseChatModel {
  return new ChatGroq({
    temperature: 0,
    modelName: 'llama3-8b-8192',
    streaming: false,
  });
}

function anthropicOpus(): BaseChatModel {
  return new ChatAnthropic({
    temperature: 0,
    modelName: 'claude-3-opus-20240229',
    streaming: false,
  });
}

function anthropicSonnet(): BaseChatModel {
  return new ChatAnthropic({
    temperature: 0,
    modelName: 'claude-3-sonnet-20240229',
    streaming: false,
  });
}

function anthropicHaiku(): BaseChatModel {
  return new ChatAnthropic({
    temperature: 0,
    modelName: 'claude-3-haiku-20240307',
    streaming: false,
  });
}

export {
  getStrongestModel,
  getFasterModel,
  groqChatMixtral,
  groqChatLlama,
  groqChatSmallLlama,
  anthropicOpus,
  anthropicSonnet,
  anthropicHaiku,
  createAgent,
  createPlanner,
  createSolver,
};
