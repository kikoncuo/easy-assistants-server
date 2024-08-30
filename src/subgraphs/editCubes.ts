import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama, getFasterModel, getStrongestModel } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { getCubes, updateSemanticLayer, validateSchema } from '../utils/SemanticLayer';
import { ToolDefinition } from '@langchain/core/language_models/base';
import { getSchema, syncDatabaseSchema } from '../utils/MetabaseAPI';

interface EditCubeState extends BaseState {
  task: string;
  calculationMethods: Array<{ value: string; method: string }>;
  finalResult: string;
}


async function identifyCalculationMethod(state: EditCubeState, functions: Function[], companyName: string): Promise<EditCubeState> {
  const getCalculationSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "getCalculation",
      description: "Fetches possible calculation methods for each requested value based on the provided criteria, including explanations and formulas.",
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
                    type: "object",
                    properties: {
                      name: {
                        type: "string",
                        description: "Name of the calculation method"
                      },
                      explanation: {
                        type: "string",
                        description: "Detailed explanation of how this method calculates the value"
                      },
                      formula: {
                        type: "string",
                        description: "Proposed formula or pseudo-code for the calculation"
                      }
                    },
                    required: ["name", "explanation", "formula"]
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
  
  const model = createStructuredResponseAgent(getStrongestModel(), [getCalculationSchema]);
  
  const cubes = await getCubes(companyName);
  
  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
      ${state.task}
      And the content of the relevant cubes:
      ${JSON.stringify(cubes, null, 2)}
      
      Provide possible methods to calculate the requested value using the cube data. Be creative and thorough in your suggestions, but limit the number of options to a maximum of three. For each method, provide:
      
      1. A name for the calculation method
      2. A detailed explanation of how this method calculates the value, including why it's appropriate and any potential limitations
      3. A proposed formula or pseudo-code for the calculation, using CubeJS syntax where applicable
      
      Consider different approaches, such as aggregations, ratios, or combinations of existing measures. Ensure that your suggestions are feasible given the available data in the cubes.`
    ),
  ]);
  
  const args = message.lc_kwargs.tool_calls[0].args;
  const calculationOptions = args.calculationOptions;
  Logger.log('\nCalculation options', calculationOptions);

  const userResponses = [];

  let calculationOptionsString = "";
  for (const option of calculationOptions) {
    let calculationStr = "";
    for (const method of option.methods.slice(0, 3)) {
      calculationStr += `\t- Method: ${method.name}\n\t- Explanation: ${method.explanation}\n\t- Formula: ${method.formula}\n\n`;
    }
    calculationOptionsString = calculationOptionsString + calculationStr;
    const userOptions = [
      {
        function_name: 'calculationOptions',
        arguments: {
          calculationOptions: `We don't have a definition for ${option.value}.\nHow should the new value be calculated? Here are some options:\n\n${calculationStr}\nHow would you like to calculate it?`
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
                methodName: {
                  type: "string",
                  description: "The name of the selected calculation method"
                },
                explanation: {
                  type: "string",
                  description: "The explanation of the selected method"
                },
                formula: {
                  type: "string",
                  description: "The formula of the selected method"
                },
                modifications: {
                  type: "string",
                  description: "Any modifications or additional details provided by the user"
                }
              },
              required: ["value", "methodName", "explanation", "formula"]
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
    ${combinedResponse}
  
    Please determine the selected calculation method for each value based on the user's response. Consider the following:
    - If the user refers to one of the provided options using phrases like 'first option', 'second one', 'third option', etc., interpret it accordingly.
    - If the user refers to an option but includes modifications or additional details, interpret it as that option with the specified modifications.
    - If the user provides a specific calculation method directly, use that as the selected method.
    - Capture any modifications or additional details provided by the user in the 'modifications' field.
  
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

async function updateAndTestSemanticLayer(state: EditCubeState, sessionToken: string, databaseId: number, functions: Function[], companyName: string): Promise<EditCubeState> {
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
                  description: "Defines if the new property is a Dimension or a Measure"
                },
                fieldType: {
                  type: "string",
                  description: "cubejs type of the new field. For measures, use 'sum' or 'avg' to use aggregation functions",
                  // No enum here because we'll use a conditional validation below
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
              required: ["cubeName", "fieldName", "type", "fieldType", "sql", "title", "description"],
              description: "Details of the new fields added to the cubes",
              // Conditional validation using "if", "then", and "else"
              allOf: [
                {
                  if: {
                    properties: { dimensionOrMeasure: { const: "measure" } }
                  },
                  then: {
                    properties: {
                      type: { enum: ["sum", "avg"] }
                    }
                  },
                  else: {
                    properties: {
                      type: { type: "string" }
                    }
                  }
                }
              ]
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
    Include the cube name, field name, whether it is a dimension or a measure, the field type, the SQL expression, title, and description for each new field.
    
    Ensure to preserve all existing measures and dimensions, and consider any recommended comments on them.
    
    Try to use the formulas provided in the calculation methods. 
    If the calculationMethod requires create another extra field, try to use it on the original field that we wanted to added initially.
    If the formula needs to be adapted to fit CubeJS syntax, please do so while maintaining the original logic.
    IE:
    - To create a new measure don't use other measures, aggregate function calls cannot be nested. Use the SQL value to calculate it, not the already created values on the cube.

    Here are some examples of valid measures:
        currentInventoryLevel: {
            fieldType: 'sum',
            sql: \`(total_purchased - total_sold)\`,
        },
        potentialWastage: {
          sql: \`potential_wastage\`,
          fieldType: 'sum',
        },
        avgCostOfWastage: {
          sql: \`potential_wastage * unit_cost\`,
          fieldType: 'avg',
        }

      Here is an example of an incorrect measure using type 'number' that is nesting aggregate functions:
        {
          "fieldType": "number",
          "sql": "SUM(\${Order.netRevenue})",
        }

    When creating the SQL field of the cubes, remember that {CUBE.value} references a measure or dimension of the cube and {CUBE}.value references the sql field called value of the cube.
    Never use placeholders for values.   

    Do not create new Cubes, modify the existing ones if necessary only.`),
  ]);

  let newFields = message.lc_kwargs.tool_calls[0].args.newFields;
  Logger.log({newFields})

  const approveSemantycLayerChanges = [
    {
      function_name: 'approveSemantycLayerChanges',
      arguments: {
        newFields: `New fields: ${JSON.stringify(newFields, null, 2)}`
      },
    },
  ];

  // Send options to user via WebSocket
  const approveResponse = await functions[0]('tool', approveSemantycLayerChanges); 
  if (approveResponse.approveSemantycLayerChanges === "false") {
    const processInfo = [
      {
        function_name: 'processInfo',
        arguments: {
          infoMessage: `The Semantic Layer has not been updated. Changes denied by user`
        },
      },
    ];
    functions[0]('tool', processInfo);

    const finalResult = `Task: ${state.task}; Calculation Method: ${JSON.stringify(state.calculationMethods)}; Updated Semantic Layer: Not updated`;
    return {
      ...state,
      finalResult,
    };
  }
 
  // Retry loop until the schema is valid
  let schemaValid = false;
  let errorFeedback = '';
  let attempts = 0;

  while (!schemaValid && attempts < 3) {
    attempts++;
    Logger.log('New fields: ', newFields)
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
        
        Please provide a corrected version of the new fields to include the new calculated value.
        Ensure that you maintain the user's chosen calculation methods and any specific modifications they requested.
        Pay special attention to field types, SQL syntax, and cube structure to resolve the validation errors.`),
      ]);
  
      newFields = message.lc_kwargs.tool_calls[0].args.newFields;
    }
  }

  const processInfo = [
    {
      function_name: 'processInfo',
      arguments: {
        infoMessage: schemaValid ? `The Semantic Layer has been successfully updated.` : `The Semantic Layer has not been updated. Unsuccessful update after ${attempts} attempts.`
      },
    },
  ];
  functions[0]('tool', processInfo);

  if (schemaValid) {
    await syncDatabaseSchema(companyName, sessionToken, databaseId);

    let fieldsSync = false;
    let attemptCount = 0;
    const maxAttempts = 10;
    while (!fieldsSync && attemptCount < maxAttempts) {
      const schema = await getSchema(companyName, sessionToken, databaseId);
      fieldsSync = newFields.every((newField: { cubeName: any; fieldName: any; }) => {
        const matchingSchemaItem = schema.find(
          (schemaItem: { display_name: any; }) => schemaItem.display_name === newField.cubeName
        );
  
        if (matchingSchemaItem) {
          //Logger.log("Matching cube: ", matchingSchemaItem)
          return matchingSchemaItem.fields.some(
            (field: { name: any; }) => field.name === newField.fieldName
          );
        }
  
        return false;
      });
  
      if (!fieldsSync) {
        attemptCount++;
        Logger.log(`Schema not valid yet. Retrying attempt ${attemptCount}/${maxAttempts}...`);
        
        if (attemptCount >= maxAttempts) {
          Logger.log("Maximum attempts reached. Exiting...");
          break;
        }
        
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Espera antes de reintentar
      }
    }

    await syncDatabaseSchema(companyName, sessionToken, databaseId);
  }

  const finalResult = schemaValid
    ? `Task: ${state.task}; Calculation Methods: ${JSON.stringify(state.calculationMethods)}; Updated Semantic Layer: Successfully updated`
    : `Task: ${state.task}; Calculation Methods: ${JSON.stringify(state.calculationMethods)}; Updated Semantic Layer: Update not successful after ${attempts} attempts`;

  return {
    ...state,
    finalResult,
  };
}



export class EditCubeGraph extends AbstractGraph<EditCubeState> {
  private functions: Function[];
  private companyName: string;
  private sessionToken: string;
  private database: number;

  constructor(companyName: string, sessionToken: string, database: number, functions: Function[]) {
    const graphState: StateGraphArgs<EditCubeState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
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
    this.sessionToken = sessionToken;
    this.database = database;
  }

  getGraph(): CompiledStateGraph<EditCubeState> {
    const subGraphBuilder = new StateGraph<EditCubeState>({ channels: this.channels });

    subGraphBuilder
      .addNode('identify_calculation_method', async state => await identifyCalculationMethod(state, this.functions, this.companyName))
      .addNode('update_and_test_semantic_layer', async state => await updateAndTestSemanticLayer(state, this.sessionToken, this.database, this.functions, this.companyName))
      .addEdge(START, 'identify_calculation_method')
      .addEdge('identify_calculation_method', 'update_and_test_semantic_layer')
      .addEdge('update_and_test_semantic_layer', END);

    return subGraphBuilder.compile();
  }
}
