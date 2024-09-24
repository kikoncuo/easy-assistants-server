import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { ConfigurationManager } from '../utils/ConfigurationManager';
import { PostgresSaver } from '../checkpoint/postgres';
import { getSuggestions } from './nodes/semanticLayerLogic';

interface SuggestionsState extends BaseState {
  task: string;
  finalResult: string; 
}

type SuggestionType = 'insights' | 'getData';

export class SuggestionsGraph extends AbstractGraph<SuggestionsState> {
  private functions: Function[];
  private schema: any[];
  private suggestionType: SuggestionType;

  constructor(functions: Function[], schema: any[], suggestionType: SuggestionType) {
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
    this.suggestionType = suggestionType;
  }

  private async createSuggestions(state: SuggestionsState): Promise<SuggestionsState> {
    const { suggestions } = await getSuggestions(this.schema, this.suggestionType);

    const suggestedPrompts = [
      {
        function_name: 'getSuggestions',
        arguments: {
          suggestions
        },
      },
    ];
    await this.functions[0]('tool', suggestedPrompts);

    return { 
      ...state,
      finalResult: "Suggestions created"
     };
  }

  getGraph(): CompiledStateGraph<SuggestionsState> {
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