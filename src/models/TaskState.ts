import { ChatPromptTemplate } from "@langchain/core/prompts";

export class TaskState {
  task: string;
  plan_string: string;
  steps: Array<[string, string, string, string]>;
  results: { [key: string]: string } | null;
  result: string;
  directResponse: string | null;
  messages: ChatPromptTemplate[];

  constructor(
    task: string,
    plan_string: string,
    steps: Array<[string, string, string, string]>,
    results: { [key: string]: string } | null,
    result: string,
    directResponse: string,
    messages: ChatPromptTemplate[],
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
