// SimplePlannerGraph.ts
import { START, END, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { AbstractGraph, BaseState } from './baseGraph';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { GeneratePlanTool, PlanFinishedTool } from '../models/Tools';
import { MemorySaver } from '@langchain/langgraph';
import Logger from '../utils/Logger';
import { LLMResponseHandler } from '../utils/LLMResponseHandler';
import { createToolsAgent, getFasterModel } from '../models/Models';

interface SimplePlannerState extends BaseState {
  messages: (HumanMessage | AIMessage | SystemMessage)[];
  task: string;
  finalResult: string;
  planDone: boolean;
}

export class SimplePlannerGraph extends AbstractGraph<SimplePlannerState> {
  private functions: Function[];
  private llmResponseHandler: LLMResponseHandler;

  constructor(
    databaseId: number,
    functions: Function[],
    companyName: string,
    schema: any[]
  ) {
    const graphState: StateGraphArgs<SimplePlannerState>['channels'] = {
      messages: {
        value: (
          x: (HumanMessage | AIMessage | SystemMessage)[],
          y: (HumanMessage | AIMessage | SystemMessage)[]
        ) => x.concat(y),
        default: () => [],
      },
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      planDone: {
        value: (x: boolean, y?: boolean) => (typeof y === 'boolean' ? y : x),
        default: () => false,
      },
    };
    super(graphState);
    this.functions = functions;

    // Define custom tool handlers.
    // Maybe this should be passed to the processor instead of being in the constructor??
    const toolHandlers = {
      planFinished: async (args: any, toolCallId: string, state: any) => {
        console.log('Plan finished');
        return { planDone: true };
      },
    };

    this.llmResponseHandler = new LLMResponseHandler(functions, toolHandlers);
  }

  initialize(): void {
    // Implementation of initialize method we don't use it in this test
  }

  private async callModel(
    state: SimplePlannerState,
    config?: any
  ): Promise<Partial<SimplePlannerState>> {
    let { messages, task } = state;

    // Initialize messages if necessary
    messages = await this.llmResponseHandler.initializeMessages(task, messages);

    // Create an AI agent with planning tools
    const model = createToolsAgent(getFasterModel(), [GeneratePlanTool, PlanFinishedTool]);

    // Process the response from LLM
    const response = await this.llmResponseHandler.processResponse(
      { ...state, messages },
      model,
      config
    );

    return {
      ...state,
      ...response,
    };
  }

  private async shouldContinue(state: SimplePlannerState) {
    // If plan is not done, continue looping; otherwise, end
    Logger.log('Checking if plan is done');
    Logger.log(state.planDone);
    return state.planDone ? END : 'agent';
  }

  getGraph(): any {
    const graphBuilder = new StateGraph<SimplePlannerState>({
      channels: this.channels,
    });

    graphBuilder
      .addNode('agent', this.callModel.bind(this))
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', this.shouldContinue.bind(this));

    // Use in-memory checkpointing
    const memory = new MemorySaver();

    return graphBuilder.compile({ checkpointer: memory });
  }

  getApp(): any {
    return this.getGraph();
  }
}
