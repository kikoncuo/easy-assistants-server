import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { GenerateCubeJSCubesTool } from '../models/Tools';
import { anthropicSonnet, createStructuredResponseAgent } from '../models/Models';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { fetchSchema } from './nodes/cardLogic';

interface CreateCubeState extends BaseState {
  databaseId: number;
  sessionToken: string;
  schema: any[];
  cubes: string[];
  companyName: string;
  error: string | null;
}

export class CreateCubeGraph extends AbstractGraph<CreateCubeState> {
  private functions: Function[];

  constructor(functions: Function[]) {
    const graphState: StateGraphArgs<CreateCubeState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      databaseId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      sessionToken: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      schema: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      cubes: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      companyName: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      error: {
        value: (x: string | null, y?: string | null) => (y !== undefined ? y : x),
        default: () => null,
      },
    };
    super(graphState);
    this.functions = functions;
  }

  private async fetchSchemaNode(state: CreateCubeState): Promise<CreateCubeState> {
    try {
      const { sessionToken, schema } = await fetchSchema(state.companyName, state.databaseId);
      return { ...state, sessionToken, schema, error: null };
    } catch (error) {
      Logger.error('Error fetching schema:', error);
      return { ...state, error: 'Failed to fetch schema. Please try again.' };
    }
  }

  private async createCubesNode(state: CreateCubeState): Promise<CreateCubeState> {
    if (state.error) return state;

    try {
      const model = createStructuredResponseAgent(anthropicSonnet(), [GenerateCubeJSCubesTool]);

      const message = await model.invoke([
        new HumanMessage(`You are a data modeling expert. Your task is to create CubeJS cubes based on the following database schema:

        ${JSON.stringify(state.schema, null, 2)}

        Create a CubeJS cube for each table in the schema. Follow these guidelines:
        1. Use the table name as the cube name.
        2. Include all fields from the table as measures or dimensions.
        3. Create appropriate joins between cubes based on foreign key relationships.
        4. Use appropriate types for measures and dimensions (e.g., 'time' for date fields, 'number' for numeric fields).
        5. Include titles and descriptions to explain the purpose of each cube and its fields.

        Return the cubes as an array of strings, where each string is the complete code for one cube.`)
      ]);

      const cubes = message.content as any;
     
      // Convert the structured cube definitions to JavaScript strings
      const cubeStrings = cubes.cubes.map((cube: any) => {
        return `cube(\`${cube.name}\`, {
    sql: \`${cube.sql}\`,
    
    measures: {
      ${cube.measures.map((measure: any) => `
      ${measure.name}: {
        type: "${measure.type}",
        sql: \`${measure.sql}\`,
        description: "${measure.description || ''}"
      }`).join(',')}
    },
    
    dimensions: {
      ${cube.dimensions.map((dimension: any) => `
      ${dimension.name}: {
        type: "${dimension.type}",
        sql: \`${dimension.sql}\`,
        description: "${dimension.description || ''}"
      }`).join(',')}
    },
    
    ${cube.joins ? `joins: {
      ${cube.joins.map((join: any) => `
      ${join.name}: {
        relationship: "${join.relationship}",
        sql: \`${join.sql}\`
      }`).join(',')}
    },` : ''}
  });`;
      });

      return { ...state, cubes: cubeStrings, error: null };
    } catch (error) {
      Logger.error('Error creating cubes:', error);
      return { ...state, error: 'Failed to create cubes. Please try again.' };
    }
  }

  private async saveCubesNode(state: CreateCubeState): Promise<CreateCubeState> {
    if (state.error) return state;

    try {
      // Prepare the cubes data to send to the frontend
      const cubesData = state.cubes.map((cube, index) => {
        const cubeName = cube.match(/cube\(`([^`]+)`/)?.[1] || `unnamed_${index + 1}`;
        return {
          name: cubeName,
          content: cube
        };
      });

      // Use the provided function to send the cubes data to the frontend
      this.functions[0]('sendCubesToFrontend', [{ cubes: cubesData }]);

      Logger.log(`Cubes data sent to frontend successfully`);
      return { ...state, error: null };
    } catch (error) {
      Logger.error('Error sending cubes data to frontend:', error);
      return { ...state, error: 'Failed to send cubes to frontend. Please try again.' };
    }
  }

  private async finalizeNode(state: CreateCubeState): Promise<CreateCubeState> {
    if (state.error) {
      return { ...state, finalResult: state.error };
    } else {
      return { ...state, finalResult: 'CubeJS cubes were successfully created and sent to the frontend.' };
    }
  }

  getGraph(): CompiledStateGraph<CreateCubeState> {
    const subGraphBuilder = new StateGraph<CreateCubeState>({ channels: this.channels });

    subGraphBuilder
      .addNode('fetch_schema', this.fetchSchemaNode.bind(this))
      .addNode('create_cubes', this.createCubesNode.bind(this))
      .addNode('save_cubes', this.saveCubesNode.bind(this))
      .addNode('finalize', this.finalizeNode.bind(this))
      .addEdge(START, 'fetch_schema')
      .addEdge('fetch_schema', 'create_cubes')
      .addEdge('create_cubes', 'save_cubes')
      .addEdge('save_cubes', 'finalize')
      .addEdge('finalize', END);

    return subGraphBuilder.compile();
  }
}