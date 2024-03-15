/** @format */

// models.ts
import { ChatOpenAI } from "langchain/chat_models/openai";
import { ChatGroq } from "@langchain/groq";
import { ChatAnthropicTools } from "@langchain/anthropic/experimental";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Runnable } from "langchain/runnables";
import {
  BaseLanguageModelCallOptions,
  ToolDefinition,
} from "@langchain/core/language_models/base";

export interface ChatToolsCallOptions extends BaseLanguageModelCallOptions {
  tools?: ToolDefinition[];
  tool_choice?:
    | "auto"
    | {
        function: {
          name: string;
        };
        type: "function";
      };
}

// Helper functions:
function createAgent(
  llm: BaseChatModel<ChatToolsCallOptions>,
  tools: ToolDefinition[]
): Runnable {
  const bindedLLM = llm.bind({
    tools: tools,
    tool_choice: "auto",
  });

  return bindedLLM;
}

// Models:
function getStrongestModel(): BaseChatModel {
  return new ChatOpenAI({
    modelName: "gpt-4-turbo-preview",
    streaming: true,
    temperature: 0,
  });
}

function getFasterModel(): BaseChatModel {
  return new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    streaming: true,
    temperature: 0,
  });
}

function groqChatMixtral(): BaseChatModel {
  return new ChatGroq({
    temperature: 0,
    modelName: "mixtral-8x7b-32768",
    streaming: true,
  });
}

function groqChatLlama(): BaseChatModel {
  return new ChatGroq({
    temperature: 0,
    modelName: "llama2-70b-4096",
    streaming: true,
  });
}

function anthropicOpus(): BaseChatModel {
  return new ChatAnthropicTools({
    temperature: 0,
    modelName: "claude-3-opus-20240229",
    streaming: true,
  });
}

function anthropicSonnet(): BaseChatModel {
  return new ChatAnthropicTools({
    temperature: 0,
    modelName: "claude-3-sonnet-20240229",
    streaming: true,
  });
}

export {
  getStrongestModel,
  getFasterModel,
  groqChatMixtral,
  groqChatLlama,
  anthropicOpus,
  anthropicSonnet,
  createAgent,
};
