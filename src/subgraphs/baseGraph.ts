import { CompiledStateGraph, StateGraphArgs } from "@langchain/langgraph";

// Define a generic state type
export interface BaseState {
  task: string;
}

// Define a generic graph interface
interface IGraph<T extends BaseState> {
  getGraph: () => CompiledStateGraph<T>;
}

// Define a generic abstract class
export abstract class AbstractGraph<T extends BaseState> implements IGraph<T> {
  protected channels: StateGraphArgs<T>["channels"];

  constructor(channels: StateGraphArgs<T>["channels"]) {
    this.channels = channels;
  }

  abstract getGraph(): CompiledStateGraph<T>;
}

