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

async function identifyRelevantCubes(state: EditCubeState, company_name: string): Promise<EditCubeState> {
  const getCubesSchema = z.object({
    relevantCubes: z.array(z.string()).describe('Array with the names of the relevant cubes'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getCubesSchema);
  const cubes = await getCubes(company_name);

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

async function identifyCalculationMethod(state: EditCubeState, functions: Function[]): Promise<EditCubeState> {
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

  let calculationStr = calculationMethods.join('\n');

  const calculationOptions = [
    {
      function_name: 'calculationOptions',
      arguments: {
        calculationOptions: `Here are possible ways to calculate the requested value. Please choose one: \n${calculationStr}`
      },
    },
  ];

  // Send options to user via WebSocket
  const response = await functions[0]('tool', calculationOptions); // {"function_name":"calculationOptions","response":"1"}
  const optionSelectedResponse = JSON.parse(response.calculationOptions);

  // Automatically select the first option
  const selectedMethod = calculationMethods[optionSelectedResponse.response];

  // Simulate a delay to allow time for the message to be sent to the client
  await new Promise(resolve => setTimeout(resolve, 1000));

  return {
    ...state,
    calculationMethod: selectedMethod,
  };
}

async function updateAndTestSemanticLayer(state: EditCubeState, company_name: string): Promise<EditCubeState> {
  const updateSchema = z.object({
    updatedLayer: z.string().describe('Updated semantic layer content'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), updateSchema);
  const relevantCubesContent = await Promise.all(state.relevantCubes.map(cube => getCubes(cube)));
  console.log({relevantCubesContent})

  console.log({calculationMethod: state.calculationMethod})
  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
    ${state.task}

    With the calculation method defined as:
    ${state.calculationMethod}

    And the content of the relevant CubeJS cubes:
    ${relevantCubesContent.join('\n\n')}

    Please update the semantic layer to include this new calculated value. Provide the updated semantic layer content.
    
    Before updating, check if any existing measures or dimensions have recommended comments and take those comments into consideration while updating. Preserve all existing measures and dimensions.
    `), 
  ]);

  const updatedLayer = (message as any).updatedLayer;

  // Update the semantic layer
  await updateSemanticLayer(updatedLayer, company_name);

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
  // private wsFunction: (type: string, data: any) => void;
  private functions: Function[];
  private company_name: string;

  constructor(company_name: string, functions: Function[]) {
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
    this.functions = functions;
    this.company_name = company_name;
  }

  getGraph(): CompiledStateGraph<EditCubeState> {
    const subGraphBuilder = new StateGraph<EditCubeState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_relevant_cubes', async state => await identifyRelevantCubes(state, this.company_name))
      .addNode('identify_calculation_method', async state => await identifyCalculationMethod(state, this.functions))
      .addNode('update_and_test_semantic_layer', async state => await updateAndTestSemanticLayer(state, this.company_name))
      .addEdge(START, 'identify_relevant_cubes')
      .addEdge('identify_relevant_cubes', 'identify_calculation_method')
      .addEdge('identify_calculation_method', 'update_and_test_semantic_layer')
      .addEdge('update_and_test_semantic_layer', END);

    return subGraphBuilder.compile();
  }
}