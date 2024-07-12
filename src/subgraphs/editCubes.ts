import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { getCubes, updateSemanticLayer, testValue } from '../utils/SemanticLayer';

interface EditCubeState extends BaseState {
  task: string;
  relevantCubes: string[];
  calculationMethod: string;
  userDefinition: string;
  updatedLayer: string;
  testResult: string;
  finalResult: string; 
}

async function identifyRelevantCubes(state: EditCubeState): Promise<EditCubeState> {
  const getCubesSchema = z.object({
    relevantCubes: z.array(z.string()).describe('Array with the names of the relevant cubes'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getCubesSchema);
  const cubes = await getCubes();

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant cubes for a given request. Your goal is to analyze the provided cube descriptions and determine which cubes could be useful in addressing the request.

    Available cubes:
    ${cubes}

    Consider the following request:
    ${state.task}
    
    Identify the cubes that are most relevant to this request.`),
  ]);

  const relevantCubes = (message as any).relevantCubes;
  Logger.log('\nRelevant cubes', relevantCubes);

  return {
    ...state,
    relevantCubes,
  };
}

async function identifyCalculationMethod(state: EditCubeState, wsFunction: (type: string, data: any) => void): Promise<EditCubeState> {
  const getCalculationSchema = z.object({
    calculationMethods: z.array(z.string()).describe('Array of possible calculation methods'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getCalculationSchema);
  const relevantCubesContent = await Promise.all(state.relevantCubes.map(cube => getCubes(cube)));

  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
    ${state.task}

    And the content of the relevant cubes:
    ${relevantCubesContent.join('\n\n')}

    Provide possible methods to calculate the requested value using the cube data. Be creative and thorough in your suggestions.`),
  ]);

  const calculationMethods = (message as any).calculationMethods;
  Logger.log('\nCalculation methods', calculationMethods);

  let calculationStr = calculationMethods.join();

  // Send options to user via WebSocket
  wsFunction('calculationOptions',
  `Here are possible ways to calculate the requested value. Please choose one: ${calculationStr}`
  );

  // Automatically select the first option
  const selectedMethod = calculationMethods[4];

  // Simulate a delay to allow time for the message to be sent to the client
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Send the selected method back to the client
  wsFunction('selectedCalculationMethod', `Selected calculation method: ${selectedMethod}`);

  return {
    ...state,
    calculationMethod: selectedMethod,
  };
}

async function updateAndTestSemanticLayer(state: EditCubeState): Promise<EditCubeState> {
  const updateSchema = z.object({
    updatedLayer: z.string().describe('Updated semantic layer content'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), updateSchema);
  const relevantCubesContent = await Promise.all(state.relevantCubes.map(cube => getCubes(cube)));

  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
    ${state.task}

    With the calculation method defined as:
    ${state.calculationMethod}

    And the content of the relevant cubes:
    ${relevantCubesContent.join('\n\n')}

    Please update the semantic layer to include this new calculated value. Provide the updated semantic layer content.
    
    For time-based calculations, use EXACTLY this structure, replacing only the 'X' with the appropriate number of days:
      activeUsers: {
      sql: \`\${CUBE}.customer_id\`,
      type: \`countDistinct\`,
      filters: [
        { sql: \`\${CUBE}.transaction_date >= DATE_TRUNC('day', \${CUBE}.transaction_date) - INTERVAL 'X days'\` }
      ],
      title: \`Active Users (Last X Days of Date Range)\`
    }

    Do NOT replace \`\${CUBE}.transaction_date\` with NOW() or any other function. Use the exact structure provided, only changing 'X' to the appropriate number.  
    
    Before updating, check if any existing measures or dimensions have recommended comments and take those comments into consideration while updating. Preserve all existing measures and dimensions.
    `), 
  ]);

  const updatedLayer = (message as any).updatedLayer;
  // Logger.log('\nUpdated semantic layer', updatedLayer);

  // Update the semantic layer
  await updateSemanticLayer(updatedLayer);

  // Test the new value
  const testResult = await testValue(state.task, state.calculationMethod);

  const finalResult = `
    Task: ${state.task}
    Calculation Method: ${state.calculationMethod}
    Updated Semantic Layer: Successfully updated
    Test Result: ${testResult}
  `;

  return {
    ...state,
    updatedLayer,
    testResult,
    finalResult, 
  };
}

export class EditCubeGraph extends AbstractGraph<EditCubeState> {
  private wsFunction: (type: string, data: any) => void;

  constructor(wsFunction: (type: string, data: any) => void) {
    const graphState: StateGraphArgs<EditCubeState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      relevantCubes: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      calculationMethod: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      userDefinition: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      updatedLayer: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      testResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: { 
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
    };
    super(graphState);
    this.wsFunction = wsFunction;
  }

  getGraph(): CompiledStateGraph<EditCubeState> {
    const subGraphBuilder = new StateGraph<EditCubeState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_relevant_cubes', async state => await identifyRelevantCubes(state))
      .addNode('identify_calculation_method', async state => await identifyCalculationMethod(state, this.wsFunction))
      .addNode('update_and_test_semantic_layer', async state => await updateAndTestSemanticLayer(state))
      .addEdge(START, 'identify_relevant_cubes')
      .addEdge('identify_relevant_cubes', 'identify_calculation_method')
      .addEdge('identify_calculation_method', 'update_and_test_semantic_layer')
      .addEdge('update_and_test_semantic_layer', END);

    return subGraphBuilder.compile();
  }
}