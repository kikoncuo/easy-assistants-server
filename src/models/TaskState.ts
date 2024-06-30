export type Message = { text: string[][]; additionalData?: any; };

export class TaskState {
  task: string;
  agentName: string;
  agentDescription: string;
  result: string;
  directResponse: string | null;
  messages: Message[];

  constructor(
    task: string,
    agentName: string,
    agentParameters: string[],
    agentDescription: string,
    result: string,
    directResponse: string,
    messages: Message[],
  ) {
    this.task = task;
    this.agentName = agentName;
    this.agentDescription = agentDescription;
    this.result = result;
    this.directResponse = directResponse;
    this.messages = messages;
  }
}
