/** @format */

// models.ts
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { ChatGroq } from '@langchain/groq';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelCallOptions, ToolDefinition } from '@langchain/core/language_models/base';
import { z } from 'zod';

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
    steps: z.array(StepSchema).min(1).max(20).optional().describe('An array of step objects, representing the entire process'),
    directResponse: z.string().optional().describe('A string with the response, used when there is no need to create a process with various steps'),
  })
  .describe('The root object containing the array of steps or the direct response to the user.');

const solverSchema = z.object({
  status: z.enum(['successful', 'failed']).describe('The status of the solver, either successful or failed'),
  explanation: z.string().optional().describe('Explanation of the status and value'),
  value: z.string().optional().describe('The optional, final, concise, value returned to the user if the response has a value.'),
});

const directResponseSchema = z.object({
  response: z.string().describe('The response returned to the user'),
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
function createPlanner(llm: BaseChatModel<ChatToolsCallOptions>): BaseChatModel {
  const bindedLLM = llm.withStructuredOutput ? llm.withStructuredOutput(planSchema) : llm;
  return bindedLLM as BaseChatModel;
}

function createSolver(llm: BaseChatModel<ChatToolsCallOptions>): BaseChatModel {
  const bindedLLM = llm.withStructuredOutput ? llm.withStructuredOutput(solverSchema) : llm;
  return bindedLLM as BaseChatModel;
}

function createStructuredResponseAgent(llm: BaseChatModel<ChatToolsCallOptions>, structuredResponseSchema: z.ZodSchema): BaseChatModel {
  const bindedLLM = llm.withStructuredOutput ? llm.withStructuredOutput(structuredResponseSchema) : llm;
  return bindedLLM as BaseChatModel;
}

function createDirectResponse(llm: BaseChatModel<ChatToolsCallOptions>): BaseChatModel {
  const bindedLLM = llm.withStructuredOutput ? llm.withStructuredOutput(directResponseSchema) : llm;
  return bindedLLM as BaseChatModel;
}

function createAgent(llm: BaseChatModel<ChatToolsCallOptions>, tools: ToolDefinition[], forceTool: boolean = false): BaseChatModel { 
  const bindedLLM = llm.bind({
    tools: tools,
    tool_choice: forceTool ? tools[0] : 'auto',
  });

  return bindedLLM as BaseChatModel;
}

// Models:
function getStrongestModel(): BaseChatModel { // TODO: Fix the type error here after full release 0.2 of langchain, after hours of work we've confirmed that this is a bug in the langchain package and it does work as expected
  return new ChatOpenAI({
    modelName: 'gpt-4o',
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
  createDirectResponse,
  createStructuredResponseAgent,
};
