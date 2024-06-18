import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringWithAutocomplete } from "@langchain/core/utils/types";
import { MessageContent, MessageType } from "langchain/schema";

export class TaskState {
  task: string;
  plan_string: string;
  steps: Array<[string, string, string, string]>;
  results: { [key: string]: string } | null;
  result: string;
  directResponse: string | null;
  messages: string[][];

  constructor(
    task: string,
    plan_string: string,
    steps: Array<[string, string, string, string]>,
    results: { [key: string]: string } | null,
    result: string,
    directResponse: string,
    messages: string[][],
  ) {
    this.task = task;
    this.plan_string = plan_string;
    this.steps = steps;
    this.results = results;
    this.result = result;
    this.directResponse = directResponse;
    this.messages = messages;
  }
}
