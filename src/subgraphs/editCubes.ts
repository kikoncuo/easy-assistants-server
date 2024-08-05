import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama, getFasterModel, getStrongestModel } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { getCubes, updateSemanticLayer, validateSchema } from '../utils/SemanticLayer';
import { ToolDefinition } from '@langchain/core/language_models/base';

interface EditCubeState extends BaseState {
  task: string;
  relevantCubes: string[];
  calculationMethods: Array<{ value: string; method: string }>;
  finalResult: string;
}


async function identifyCalculationMethod(state: EditCubeState, functions: Function[], companyName: string): Promise<EditCubeState> {
  const getCalculationSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "getCalculation",
      description: "Fetches possible calculation methods for each requested value based on the provided criteria.",
      parameters: {
        type: "object",
        properties: {
          calculationOptions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: {
                  type: "string",
                  description: "The value to be calculated"
                },
                methods: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                  description: "Array of possible calculation methods for this value"
                }
              },
              required: ["value", "methods"]
            },
            description: "Array of calculation options for each requested value"
          }
        },
        required: ["calculationOptions"]
      }
    }
  };
  const model = createStructuredResponseAgent(anthropicSonnet(), [getCalculationSchema]);
  const cubes = await getCubes(companyName); 

  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
    ${state.task}

    And the content of the relevant cubes:
    ${JSON.stringify(cubes, null, 2)}

    Provide possible methods to calculate the requested value using the cube data. Be creative and thorough in your suggestions, but limit the number of options to a maximum of three.`),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;
  const calculationOptions = args.calculationOptions;
  Logger.log('\nCalculation options', calculationOptions);

  const userResponses = [];

  let calculationOptionsString = "";
  for (const option of calculationOptions) {
    const calculationStr = `For ${option.value}:\n${option.methods.slice(0, 3).map((method: any) => `- ${method}`).join('\n')}`;
    calculationOptionsString = calculationOptionsString + calculationStr;
    const userOptions = [
      {
        function_name: 'calculationOptions',
        arguments: {
          calculationOptions: `How should ${option.value} be calculated? Here are the options:\n\n${calculationStr}\n\nPlease provide your selection for this value.`
        },
      },
    ];

    // Send options to user via WebSocket for each value
    const response = await functions[0]('tool', userOptions);
    userResponses.push({ value: option.value, response: response.calculationOptions });
  }

  // Combine all user responses
  const combinedResponse = userResponses.map(r => `For ${r.value}: ${r.response}`).join('\n\n');

  // Interpret the user's response
  const interpretResponseSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "interpretResponse",
      description: "Interprets the user response and determines the calculation methods for each value.",
      parameters: {
        type: "object",
        properties: {
          methods: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: {
                  type: "string",
                  description: "The value to be calculated"
                },
                method: {
                  type: "string",
                  description: "The selected calculation method for this value"
                }
              },
              required: ["value", "method"]
            },
            description: "Array of selected calculation methods for each value"
          }
        },
        required: ["methods"]
      }
    }
  };
  const interpretModel = createStructuredResponseAgent(getFasterModel(), [interpretResponseSchema]);

  const interpretMessage = await interpretModel.invoke([
    new HumanMessage(`Based on the user's request:
    ${state.task}

    We provided the user possible options:
    ${calculationOptionsString}

    The user responded with:
    ${/*optionSelectedResponse.*/combinedResponse}

    Please determine the selected calculation method for each value based on the user's response. Consider the following:
    - If the user refers to one of the provided options using phrases like 'first option', 'second one', 'third option', etc., interpret it accordingly.
    - If the user refers to an option but includes modifications or additional details, interpret it as that option with the specified modifications.
    - If the user provides a specific calculation method directly, use that as the selected method.

    Return the selected calculation methods for each value based on the user's response, ensuring to account for any modifications or additional details provided by the user.`),
  ]);

  const interpretArgs = interpretMessage.lc_kwargs.tool_calls[0].args;

  const methods = interpretArgs.methods;
  Logger.log('\nSelected calculation methods', methods);

  return {
    ...state,
    calculationMethods: methods,
  };
}

async function updateAndTestSemanticLayer(state: EditCubeState, functions: Function[], companyName: string): Promise<EditCubeState> {
  const updateLayerSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "updateLayer",
      description: "Updates the semantic layer content and specifies the new fields to be added.",
      parameters: {
        type: "object",
        properties: {
          newFields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                cubeName: {
                  type: "string",
                  description: "Name of the cube where the new field was added"
                },
                fieldName: {
                  type: "string",
                  description: "Name of the new field"
                },
                type: {
                  type: "string",
                  enum: ["dimension", "measure"],
                  description: "Defines if the new propery is a Dimension or a Measure"
                },
                fieldType: {
                  type: "string",
                  description: "Type of the new field"
                },
                sql: {
                  type: "string",
                  description: "SQL expression for the new field"
                },
                title: {
                  type: "string",
                  description: "Title of the new field"
                },
                description: {
                  type: "string",
                  description: "Description of the new field"
                }
              },
              required: ["cubeName", "fieldName", "fieldType", "sql", "title", "description"],
              description: "Details of the new fields added to the cubes"
            },
            description: "List of new fields added to the cubes"
          }
        },
        required: ["newFields"]
      }
    }
  };
  const model = createStructuredResponseAgent(anthropicSonnet(), [updateLayerSchema]);
  const cubes = await getCubes(companyName);

  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
    ${state.task}

    With the calculation methods defined as:
    ${JSON.stringify(state.calculationMethods, null, 2)}

    And the available cubes:
    ${JSON.stringify(cubes, null, 2)}

    Please provide the details of the new fields to be added to the necessary cubes to include this new calculated value.
    Include the cube name, field name, whether it is a dimension or a measure, the SQL expression, title, and description for each new field.
    
    Ensure to preserve all existing measures and dimensions, and consider any recommended comments on them.`),
  ]);

  let newFields = message.lc_kwargs.tool_calls[0].args.newFields;
  Logger.log({newFields})

  const approveSemantycLayerChanges = [
    {
      function_name: 'approveSemantycLayerChanges',
      arguments: {
        newFields: JSON.stringify(newFields, null, 2)
      },
    },
  ];

  // Send options to user via WebSocket
  const approveResponse = await functions[0]('tool', approveSemantycLayerChanges); 
  if (approveResponse.approveSemantycLayerChanges === "false" ) {
    const processInfo = [
      {
        function_name: 'processInfo',
        arguments: {
          infoMessage: `The Semantyc Layer has not been updated. Changes denied by user`
        },
      },
    ];
    functions[0]('tool', processInfo);

    const finalResult = `Task: ${state.task}; Calculation Method: ${state.calculationMethods}; Updated Semantic Layer: Not updated`;
    return {
      ...state,
      finalResult,
    };
  }
 
  // Bucle de reintento hasta que el esquema sea válido
  let schemaValid = false;
  let errorFeedback = '';
  let attempts = 0;

  while (!schemaValid && attempts < 3) {
    attempts++;
    const { success, errors, newPayload } = await updateSemanticLayer(newFields, companyName);
    schemaValid = success;
    errorFeedback = errors.join('; ');

    if (!schemaValid && attempts < 3) {
      Logger.log('\nSchema validation failed', errorFeedback);
  
      // Retry updating the semantic layer with feedback
      const message = await model.invoke([
        new HumanMessage(`The following update to the semantic layer resulted in an invalid schema:
        ${newPayload}
        
        Error details: ${errorFeedback}
        
        Please provide a corrected version of the new fields to include the new calculated value.`),
      ]);
  
      newFields = message.lc_kwargs.tool_calls[0].args.newFields;
    }
  }

  const processInfo = [
    {
      function_name: 'processInfo',
      arguments: {
        infoMessage: schemaValid ? `The Semantyc Layer has been successfully updated.` : `The Semantyc Layer has not been updated. Unsuccessful update.`
      },
    },
  ];
  functions[0]('tool', processInfo);

  const finalResult = schemaValid
    ? `Task: ${state.task}; Calculation Methods: ${JSON.stringify(state.calculationMethods)}; Updated Semantic Layer: Successfully updated`
    : `Task: ${state.task}; Calculation Methods: ${JSON.stringify(state.calculationMethods)}; Updated Semantic Layer: Update not successful`;

  return {
    ...state,
    finalResult,
  };
}



export class EditCubeGraph extends AbstractGraph<EditCubeState> {
  private functions: Function[];
  private companyName: string;

  constructor(companyName: string, functions: Function[]) {
    const graphState: StateGraphArgs<EditCubeState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      relevantCubes: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      calculationMethods: {
        value: (x: Array<{ value: string; method: string }>, y?: Array<{ value: string; method: string }>) => (y ? y : x),
        default: () => [],
      },
      finalResult: { 
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      }
    };
    super(graphState);
    this.functions = functions;
    this.companyName = companyName;
  }

  getGraph(): CompiledStateGraph<EditCubeState> {
    const subGraphBuilder = new StateGraph<EditCubeState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_calculation_method', async state => await identifyCalculationMethod(state, this.functions, this.companyName))
      .addNode('update_and_test_semantic_layer', async state => await updateAndTestSemanticLayer(state, this.functions, this.companyName))
      .addEdge(START, 'identify_calculation_method')
      .addEdge('identify_calculation_method', 'update_and_test_semantic_layer')
      .addEdge('update_and_test_semantic_layer', END);

    return subGraphBuilder.compile();
  }
}
