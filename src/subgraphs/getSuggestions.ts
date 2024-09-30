import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { getSuggestions } from './nodes/semanticLayerLogic';

interface SuggestionsState extends BaseState {
  task: string;
  finalResult: string; 
}

export class SuggestionsGraph extends AbstractGraph<SuggestionsState> {
  private functions: Function[];
  private schema: any[];

  constructor(functions: Function[], schema: any[]) {
    const graphState: StateGraphArgs<SuggestionsState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      }
    };
    super(graphState);
    this.functions = functions;
    this.schema = schema;
  }

  private async createSuggestions(state: SuggestionsState): Promise<SuggestionsState> {
    const { getDataSuggestions, insightsSuggestions } = await getSuggestions(this.schema);

    const suggestedPrompts = [
      {
        function_name: 'getSuggestions',
        arguments: {
          suggestions: { getDataSuggestions, insightsSuggestions }
        },
      },
    ];
    await this.functions[0]('tool', suggestedPrompts);

    return { 
      ...state,
      finalResult: "Suggestions created"
     };
  }

  getGraph(): any {
    const graphBuilder = new StateGraph<SuggestionsState>({ channels: this.channels });

    graphBuilder
      .addNode("create_suggestions", this.createSuggestions.bind(this))
      .addEdge(START, "create_suggestions")
      .addEdge("create_suggestions", END)
    
    return graphBuilder.compile();
  }

  getApp(): any {
    return this.getGraph();
  }
}