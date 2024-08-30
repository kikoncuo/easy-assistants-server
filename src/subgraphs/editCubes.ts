import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama, getFasterModel, getStrongestModel } from '../models/Models';
import { getCalculationSchemaTool, UpdateCubeJSSchemaTool, InterpretUserResponseTool, CheckFieldsTool } from '../models/Tools';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { getCubes, updateSemanticLayer, validateSchema } from '../utils/SemanticLayer';
import { ToolDefinition } from '@langchain/core/language_models/base';
import { getSchema, syncDatabaseSchema } from '../utils/MetabaseAPI';

interface EditCubeState extends BaseState {
  task: string;
  calculationMethod: string;
  finalResult: string;
  newFields: any[];
  userFeedback: string;
  stopExecution: boolean;
}


async function identifyCalculationMethod(state: EditCubeState, functions: Function[], companyName: string): Promise<EditCubeState> {
  
  const model = createStructuredResponseAgent(getStrongestModel(), [getCalculationSchemaTool]);
  
  const cubes = await getCubes(companyName);
  
  const message = await model.invoke([
    new HumanMessage(`Based on the following request:
      ${state.task}
      And the content of the relevant cubejs cubes:
      ${JSON.stringify(cubes, null, 2)}
      
      Provide possible methods to calculate the requested value using the cube data. Be creative and thorough in your suggestions, but limit the number of options to a maximum of three. For each method, provide:
      
      1. A name for the calculation method
      2. A detailed explanation of how this method calculates the value, including why it's appropriate and any potential limitations
      3. A proposed formula or pseudo-code for the calculation, using sql syntax where applicable
      
      Consider different approaches, such as aggregations in measures or new data points in dimensions. Ensure that your suggestions are feasible given the available cubeJS cubes.`
      // TODO: Give the model a way to specify that it can't be done
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
          method: {
            type: "string",
            description: "A string describing how the value should be calculated, include as much detail as possible"
          },
        },
        required: ["method"]
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
  
    Return the selected calculation methods for each value based on the user's response, ensuring to account for any modifications or additional details provided by the user.
    Examples:
    1. Calculate the total amount of individual items purchased. 
    Take into consideration that each item comes in a pack, which comes in a case, so you will need to check how many cases where bought, how many packs come in each case and how many items come in each pack.
    A recommended formula is "case_quantity * packs_per_case * items_per_pack"

    2. Calculate the price of an individual item by looking at the unit price for the case bought where it came from.
    Take into consideration that each item comes in a pack, which comes in a case, so you will need to check how many cases where bought, how many packs come in each case and how many items come in each pack.
    A recommended formula is "unit_price / (case_quantity * packs_per_case * items_per_pack)" 

    3. Calculate the amount of products wasted by looking at how many were purchased and how many were sold at any given day.
    Product lifetime value for this company is 1 day
    A recommended formula is "total_purchased - total_sold"

    4. Calculate the time when a product was las purchased.
    The resulting value should be of type string and display only the hours, minutes and seconds portion of the original field’s
    A recommended formula is "SUBSTRING(lastPurchaseTime::TEXT, 12, 5)" 
    `),
  ]);
  
  const interpretArgs = interpretMessage.lc_kwargs.tool_calls[0].args;
  
  const method = interpretArgs.method;
  Logger.log('\nSelected calculation methods', method);
  
  return {
    ...state,
    calculationMethod: method,
  };
}

async function updateAndTestSemanticLayer(state: EditCubeState, sessionToken: string, databaseId: number, functions: Function[], companyName: string): Promise<EditCubeState> {

  
  const model = createStructuredResponseAgent(getStrongestModel(), [UpdateCubeJSSchemaTool]);
  const cubes = await getCubes(companyName);

  const message = await model.invoke([
    new HumanMessage(`Based on the task: ${state.task}
    The available cubes are: ${JSON.stringify(cubes, null, 2)}
    And the calculation methods: ${state.calculationMethod}
    
    Generate field definitions for the cubes. Remember:
    - Dimensions are used for aggregations, grouping and filtering (e.g., dates, categories, statuses)
    - Measures are used for numerical calculations (e.g., sums, averages, counts)
    
    For measures, use appropriate fieldTypes:
    - 'sum' for additive measures (e.g., total sales, quantity)
    - 'avg' for averages
    - 'count' or 'countDistinct' for counting
    - 'min' or 'max' for minimum or maximum values
    
    Remember:
    - When creating a new measure, avoid using other existing measures since aggregate function calls cannot be nested.
    - Always create dimensions if the fieldType is number, text, or date.
    - {CUBE.value} references a measure or dimension of the cube and {CUBE}.value references the sql field called value of the cube.
    - Never use placeholders for values. If they weren't provided, assign values yourself.
    - You can't create new CubeJS cubes. You can only modify existing ones.
    
    Here are some examples:
    
    1. Unitary Cost:
    {
      "cubeName": "Purchase",
      "fieldName": "unitaryCost",
      "type": "measure",
      "fieldType": "sum",
      "sql": "unit_price / (case_quantity * packs_per_case * items_per_pack)",
      "title": "Unitary Cost",
      "description": "The unitary cost of an individual item, calculated from the case price and item quantities"
    }
    
    2. Last Purchase Time:
    {
      "cubeName": "Inventory",
      "fieldName": "lastPurchaseTime",
      "type": "dimension",
      "fieldType": "string",
      "sql": "(lastPurchaseTime::TIME)::TEXT",
      "title": "Last Purchase Time",
      "description": "The time a product was last purchased, displayed as hours:minutes:seconds"
    }

    ${state.userFeedback ? `Previous attempt has generated the following fields ${JSON.stringify(state.newFields)}, and resulted in an error: ${state.userFeedback }\n Please adjust the query or try a different approach to avoid this error` : ''}


    `),
  ]);

  let newFields = message.lc_kwargs.tool_calls[0].args.newFields;
  Logger.log({newFields})
 
  return {
    ...state,
    newFields: newFields
  };
}

async function interpretUserResponse(state: EditCubeState, functions: Function[]): Promise<EditCubeState> {
  const interpretationModel = createStructuredResponseAgent(anthropicSonnet(), [InterpretUserResponseTool]);

  const errorWarning = state.userFeedback ? `There has been an error trying to update the semantic layer with the previous fields.\nError: ${state.userFeedback}\n\n` : "";
  const approveSemantycLayerChanges = [
    {
      function_name: 'approveSemantycLayerChanges',
      arguments: {
        newFields: `${errorWarning} New fields: ${JSON.stringify(state.newFields, null, 2)}`
      },
    },
  ];
  const approveResponse = await functions[0]('tool', approveSemantycLayerChanges); 

  const messages = [
    new HumanMessage(`
    Interpret the following user response regarding proposed changes to the semantic layer:
    User response: "${approveResponse.approveSemantycLayerChanges}"
    
    Proposed changes:
    ${JSON.stringify(state.newFields, null, 2)}

    Determine if the user approves, rejects, or requests modifications to the changes.
    `),
  ];

  const message = await interpretationModel.invoke(messages);
  const interpretation = message.lc_kwargs.tool_calls[0].args;

  if (interpretation.approval === 'approved') {
    return {
      ...state
    };
  } else if (interpretation.approval === 'rejected') {
    const processInfo = [
      {
        function_name: 'processInfo',
        arguments: {
          infoMessage: `The Semantic Layer has not been updated. Changes denied by user`
        },
      },
    ];
    await functions[0]('tool', processInfo);
    const finalResult = `Semantic Layer has not been updated. Changes denied by user`;
    return {
      ...state,
      stopExecution: true,
      finalResult,
    };
  } else if (interpretation.approval === 'modifications_requested') {
    return {
      ...state,
      userFeedback: interpretation.requestedChanges
    };
  }
  return {
    ...state,
    finalResult: `The Semantic Layer has not been updated. Unknown approval state in user feedback: ${interpretation.approval}`
  };
}

async function checkFields(state: EditCubeState, functions: Function[]): Promise<EditCubeState> {
  const fieldCheckModel = createStructuredResponseAgent(getStrongestModel(), [CheckFieldsTool]);

  const message = await fieldCheckModel.invoke([
    new HumanMessage(`
    Check the following CubeJS fields for correctness:
    ${JSON.stringify(state.newFields, null, 2)}

    Evaluate each field for:
    1. Correct type (measure or dimension)
    2. Appropriate fieldType for measures (sum, avg, count, etc.)
    3. Valid SQL expression
    4. Clear and accurate title and description

    For measures, use appropriate fieldTypes:
    - 'sum' for additive measures (e.g., total sales, quantity)
    - 'avg' for averages
    - 'count' or 'countDistinct' for counting
    - 'min' or 'max' for minimum or maximum values
    
    Remember:
    - When creating a new measure, avoid using other existing measures since aggregate function calls cannot be nested.
    - Always create dimensions if the fieldType is number, text, or date.
    - {CUBE.value} references a measure or dimension of the cube and {CUBE}.value references the sql field called value of the cube.
    - Never use placeholders for values. If they weren't provided, assign values yourself.
    - You can't create new CubeJS cubes. You can only modify existing ones.

    Provide feedback only if there are issues. If all fields are correct, return an empty array.
    `),
  ]);

  const checkResult = message.lc_kwargs.tool_calls[0].args;

  if (checkResult.error.length > 0) {
    Logger.log("Feedback", JSON.stringify(checkResult.error))
    const processInfo = [
      {
        function_name: 'processInfo',
        arguments: {
          infoMessage: `Some fields need attention:\n${JSON.stringify(checkResult.error)} \nPlease give me a suggestion for how to fix the fields.`
        },
      },
    ];
    const userFeedback = await functions[0]('tool', processInfo);
    return {
      ...state,
      userFeedback: userFeedback
    };
  } else {
    return state;
  }
}

async function checkSemanticLayerUpdate(state: EditCubeState, functions: Function[], companyName: string): Promise<EditCubeState> {
  try {
    // Assuming updateSemanticLayer is a function that returns a boolean
    const { success, errors, newPayload } = await updateSemanticLayer(state.newFields, companyName);
    
    if (success) {
      const processInfo = [
        {
          function_name: 'processInfo',
          arguments: {
            infoMessage: 'Semantic Layer updated successfully.'
          },
        },
      ];
      await functions[0]('tool', processInfo);
      return {
        ...state,
      };
    } else {
      return {
        ...state,
        userFeedback: JSON.stringify(errors, null, 2),
      };
    }
  } catch (error) {
    return {
      ...state,
      userFeedback: JSON.stringify(error, null, 2),
    };
  }
}

async function waitForSemanticLayerUpdate(state: EditCubeState, functions: Function[], sessionToken: string, databaseId: number, companyName: string): Promise<EditCubeState> {
  await syncDatabaseSchema(companyName, sessionToken, databaseId);

  const maxAttempts = 10;
  const delayBetweenAttempts = 2000; // 2 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const schema = await getSchema(companyName, sessionToken, databaseId);
    let fieldsSync = state.newFields.every((newField: { cubeName: any; fieldName: any; }) => {
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
  
      if (fieldsSync) {
        Logger.log('Schema valid!');
        return {
          ...state,
          finalResult: `Task: ${state.task}; Calculation Method: ${state.calculationMethod}; Updated Semantic Layer: Successfully updated`,
        };
      }
    Logger.log(`Schema not valid yet. Retrying attempt ${attempt}/${maxAttempts}...`);
    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
  }

  const processInfo = [
    {
      function_name: 'processInfo',
      arguments: {
        infoMessage: 'Timeout: Semantic Layer value update not detected. Please try again later.'
      },
    },
  ];
  await functions[0]('tool', processInfo);
  return {
    ...state,
    finalResult: 'Timeout: Semantic Layer value update not detected after multiple attempts.'
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
      calculationMethod: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: { 
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      newFields: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      userFeedback: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',  
      },
      stopExecution: {
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
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
      .addNode('interpret_user_response', async state => await interpretUserResponse(state, this.functions))
      //.addNode('check_fields', async state => await checkFields(state, this.functions))
      .addNode('check_semantic_layer_update', async state => await checkSemanticLayerUpdate(state, this.functions, this.companyName))
      .addNode('wait_for_semantic_layer_update', async state => await waitForSemanticLayerUpdate(state, this.functions, this.sessionToken, this.database, this.companyName))
      .addEdge(START, 'identify_calculation_method')
      .addEdge('identify_calculation_method', 'update_and_test_semantic_layer')
      .addEdge('update_and_test_semantic_layer', 'interpret_user_response')
      .addConditionalEdges('interpret_user_response', (state: EditCubeState) => {
        if (state.stopExecution) {
          return END;
        } else {
          return 'check_semantic_layer_update';
        }
      })
      //.addEdge('interpret_user_response', 'check_fields')
      /*.addConditionalEdges('check_fields', (state: EditCubeState) => {
        if (state.userFeedback) {
          return 'update_and_test_semantic_layer';
        } else {
          return 'check_semantic_layer_update';
        }
      })*/
      .addConditionalEdges('check_semantic_layer_update', (state: EditCubeState) => {
        if (state.userFeedback) {
          return 'update_and_test_semantic_layer';
        } else {
          return 'wait_for_semantic_layer_update';
        }
      })
      .addEdge('wait_for_semantic_layer_update', END);
  
    return subGraphBuilder.compile();
  }
}
