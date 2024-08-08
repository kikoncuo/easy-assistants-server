import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama, getFasterModel, getStrongestModel } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { executeQuery, getModelsData, getSQLQuery } from '../utils/DataStructure';
import { EditCubeGraph } from './editCubes';
import { ToolDefinition } from '@langchain/core/language_models/base';

// Define a specific state type
interface DataRecoveryState extends BaseState {
  examples: string[];
  cubeQuery: string;
  explanation: string;
  description: string[];
  title: string;
  resultStatus: 'correct' | 'maybe' | 'incorrect';
  feedbackMessage: string | null;
  finalResult: string;
  displayType: string;
  resultExecution: string;
  needsSemanticUpdate: boolean;
  semanticTask: string; // Nueva propiedad para la tarea semántica
  queryAttempts: number; // New property to track query generation attempts
}

/*async function getModels(company_name: string): Promise<string[]> {
  return await getModelsData(company_name);
}

function filterModels(models: string[], sources: string[]): string[] {
  const parsedModels = models.map(model => JSON.parse(model));
  const filteredModels = parsedModels.filter(model => {
    return sources.includes(model.name);
  });
  return filteredModels.map(model => JSON.stringify(model));
}*/

// Node function to recover sources
async function recoverSources(
  state: DataRecoveryState,
  company_name: string,
  functions: Function[]
): Promise<DataRecoveryState> {
  //const cubeModels = await getModels(company_name);

  /*const getSources: ToolDefinition = {
    type: "function",
    function: {
      name: "getSources",
      description: "Identify relevant data sources for a given request",
      parameters: {
        type: "object",
        properties: {
          sources: {
            type: "array",
            items: { type: "string" },
            description: "Array with the names of the sources"
          },
          isPossible: {
            type: "string",
            enum: ["true", "maybe", "false"],
            description: '"true" if the data recovery is possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable'
          },
          needsSemanticUpdate: {
            type: "boolean",
            description: "Whether a semantic layer update is needed for the task."
          },
          semanticTask: {
            type: "string",
            description: "Specific measure or dimension to create on the semantic layer if needed."
          }
        },
        required: ["sources", "isPossible", "needsSemanticUpdate"]
      }
    }
  };

  const model = createStructuredResponseAgent(anthropicSonnet(), [getSources]); //Using anthropic to have an accure response on 'needsSemanticUpdate' and 'semanticTask'

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided model descriptions and examples,
        and determine which data sources could be useful in addressing the request.

        First, review the following CubeJS model descriptions to know the dimensions and measures available:
        ${cubeModels.join('\n')}
        Now, consider the following request:
        ${state.task}
        
        Keep in mind that multiple data sources may be relevant to a single request.
        If a data source seems even slightly relevant to the request, include it in your list.
        
        Also, if you think a new value in the semantic layer is 100% required for this task, specify what measure or dimension should be created on the semantic layer.
        As example, if the user request the top 5 products and we don't have a definition for 'topProducts' or it cannot be calculated using existing measures, dimensions and filters, ask to create it.
        `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const sources = args.sources;
  const isPossible = args.isPossible;
  const needsSemanticUpdate = args.needsSemanticUpdate;
  const semanticTask = args.semanticTask || '';

  Logger.log('\nisPossible', isPossible);
  Logger.log('\nsources', sources);
  Logger.log('\nneedsSemanticUpdate', needsSemanticUpdate);
  Logger.log('\nsemanticTask', semanticTask);

  const updatedState = {
    ...state,
    examples: sources,
    needsSemanticUpdate: needsSemanticUpdate,
    semanticTask: needsSemanticUpdate ? semanticTask : '',
  };

  if (isPossible === 'false') {
    const processInfo = [
      {
        function_name: 'processInfo',
        arguments: {
          infoMessage: `It wasn't possible to resolve the query with the available data`
        },
      },
    ];
    functions[0]('tool', processInfo);
    updatedState.finalResult = "It wasn't possible to resolve the query with the available data.";
    return updatedState;
  }

  return updatedState;
  */

  const newDatasetQuery = {
    database: 2,
    type: "query",
    query: {
      "source-table": 38,
      aggregation: [
        [
          "count",
        ]
      ],
      breakout: [
        [
          "field",
          283,
          {
            "base-type": "type/Text"
          }
        ]
      ]
    }
  };

  const datasetQuery = [
    {
      function_name: 'datasetQuery',
      arguments: {
        dataset: newDatasetQuery
      },
    },
  ];
  functions[0]('tool', datasetQuery);

  return {
    ...state,
    finalResult: "DataSet Query for Metabase returned"
  }
}

// Node function to create Cube query
/*async function createCubeQuery(state: DataRecoveryState, company_name: string, functions: Function[]): Promise<DataRecoveryState> {
  const getCubeQuery: ToolDefinition = {
    type: "function",
    function: {
      name: "getCubeQuery",
      description: "Generate a Cube query that satisfies the given task",
      parameters: {
        type: "object",
        properties: {
          assumptions: {
            type: "string",
            description: "Assumptions made about what the user said vs how we built the query. The assumptions need to be understood by a non-technical person who doesn't know the details of the database."
          },
          cubeQuery: {
            type: "string",
            description: "Cube query that returns a table which satisfies the task. Provide insightful queries, avoid simple logic unless asked to."
          },
          description: {
            type: "string",
            description: "Task simple description, in a simple phrase."
          },
          title: {
            type: "string",
            description: "Task title, e.g., 'Top 5 Whole Bean/Teas Products by Price' for a request to create a chart for top 5 beans based on price."
          },
          displayType: {
            type: "string",
            enum: ["table", "barChart", "doghnutChart", "lineChart", "dataPoint"],
            description: "Type of display for the query result."
          }
        },
        required: ["assumptions", "cubeQuery", "description", "title", "displayType"]
      }
    }
  };
  
  const cubeModels = await getModels(company_name);
  const filteredCubeModels = filterModels(cubeModels, state.examples);

  const model = createStructuredResponseAgent(getStrongestModel(), [getCubeQuery]);

  const messageContent = `Based on the following sources
        ${filteredCubeModels}
        please provide a Cube query that returns a table that satisfies the following task:
        ${state.task}
        For displayType charts (barChart, doghnutChart, lineChart), the query should only return 2 columns, one for labels and one for values.
        For tables, the query should include a date column.

       ${state.feedbackMessage ? `Previous attempt resulted in an error: ${state.feedbackMessage}\nPlease adjust the query to avoid this error` : ''}`;
       

  const message = await model.invoke(messageContent);

  const args = message.lc_kwargs.tool_calls[0].args;

  const cubeQuery = args.cubeQuery;
  const assumptions = args.assumptions;
  const description = args.description;
  const title = args.title;
  const displayType = args.displayType;

  Logger.log('cubeQuery', cubeQuery);
  Logger.log('assumptions', assumptions);

  //const resultExecution = await executeQueries([cubeQuery]);

  const updatedState = {
    ...state,
    cubeQuery: cubeQuery,
    explanation: assumptions,
    description: description,
    title: title,
    displayType: displayType,
    //resultExecution: resultExecution
    queryAttempts: (state.queryAttempts || 0) + 1
  };

  if (updatedState.queryAttempts > 3) {
    const processInfo = [
      {
        function_name: 'processInfo',
        arguments: {
          infoMessage: `Unable to generate a suitable query after 3 attempts.`
        },
      },
    ];
    functions[0]('tool', processInfo);
    updatedState.finalResult = "Unable to generate a suitable query after 3 attempts.";
    updatedState.resultStatus = 'incorrect';
  }

  return updatedState;
}

// Node function to evaluate result
async function evaluateResult(
  state: DataRecoveryState,
  functions: Function[],
  company_name: string
): Promise<DataRecoveryState> {
  

  try {
    const getFeedback: ToolDefinition = {
      type: "function",
      function: {
        name: "getFeedback",
        description: "Evaluate the Cube query result and provide feedback",
        parameters: {
          type: "object",
          properties: {
            resultStatus: {
              type: "string",
              enum: ["correct", "maybe", "incorrect"],
              description: "Evaluation of the query result"
            },
            feedbackMessage: {
              type: "string",
              description: "Feedback message if the query was incorrect or needs further exploration."
            }
          },
          required: ["resultStatus"]
        }
      }
    };

    const model = createStructuredResponseAgent(getStrongestModel(), [getFeedback]);

    const resultExecution = await executeQuery(state.cubeQuery, company_name); //await functions[0]('tool', getCubeQuery);

    Logger.log('\n\nresultExecution', JSON.parse(resultExecution).data);
    // log the first 10 results

    const message = await model.invoke([
      new HumanMessage(`Based on the following user request:
                ${state.task}

                with the following context:
                This query is for a business analyst to help them understand the data and make informed decisions.
                The visualization aspect of the query is not important, only the data.

                Given the following Cube query,
                ${state.cubeQuery}

                Which returned the following results (we only show the first 10 results):
                ${JSON.stringify(JSON.parse(resultExecution).data.slice(0, 10))}

                Evaluate the Cube query result:
                - 'correct' if the results from the query look correct, solve the task, and are consistent and logical.
                - 'maybe' if you're not sure and need more information or exploration, for example, if the results are empty or incomplete.
                - 'incorrect' if the results look incorrect, don't solve the task, or are inconsistent or illogical.
                Provide a feedback message for 'maybe' or 'incorrect' results, explaining what needs further exploration or how to improve the query.
            `),
    ]);

    const args = message.lc_kwargs.tool_calls[0].args;

    const resultStatus = args.resultStatus;
    const feedbackMessage = args.feedbackMessage || '';
    
    Logger.log('resultStatus', resultStatus);
    Logger.log('feedbackMessage', feedbackMessage);

    const getCubeQuery = [
      {
        function_name: "getCubeQuery",
        arguments: {
          sqlQuery: state.cubeQuery,
          data: resultExecution,
          explanation: state.explanation,
          description: state.description,
          title: state.title,
          displayType: state.displayType,
        },
      }
    ]
    if (resultStatus === 'correct' || resultStatus === 'maybe') { // TODO: Create a working path for maybe, right now it enters an infinite loop if data is empty
      functions[0]('tool', getCubeQuery);
    }

    return {
      ...state,
      resultStatus: resultStatus,
      feedbackMessage: feedbackMessage,
      finalResult: state.explanation,
    };
  } catch (error) {
    Logger.error('Error evaluating Cube query results:', error);
    return {
      ...state,
      resultStatus: 'incorrect',
      feedbackMessage: 'An error occurred while evaluating the Cube query results.',
    };
  }
}

async function returnSqlDescription(
  state: DataRecoveryState,
  functions: Function[],
  company_name: string
): Promise<DataRecoveryState> {
  

  try {
    const getFeedback: ToolDefinition = {
      type: "function",
      function: {
        name: "getFeedback",
        description: "Describe how the SQL query solves the initial task",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Description on how the SQL query is solving the initial task"
            }
          },
          required: ["description"]
        }
      }
    };

    const sqlQuery = await getSQLQuery(company_name, state.cubeQuery);

    const model = createStructuredResponseAgent(getFasterModel(), [getFeedback]);
    const message = await model.invoke([
      new HumanMessage(`Based on the following user request 
                ${state.task},
                the SQL query to solve the task is 
                ${sqlQuery}.
                
                Describe how the SQL has solved the initial request.
            `),
    ]);

    const args = message.lc_kwargs.tool_calls[0].args;
    
    const description = args.description;

    Logger.log('description', description);

    const getSqlDescription = [
      {
        function_name: "getSqlDescription",
        arguments: {
          sqlQuery: sqlQuery,
          description: description,
          explanation: state.explanation,
        },
      }
    ]

    functions[0]('tool', getSqlDescription);

    return {
      ...state,
      description: description
    };
  } catch (error) {
    Logger.error('Error getting SQL query:', error);
    return {
      ...state
    };
  }
}

async function handleEditCubeGraph(state: DataRecoveryState, functions: Function[], company_name: string): Promise<DataRecoveryState> {
  const editCubeGraph = new EditCubeGraph(company_name, functions);
  const result = await editCubeGraph.getGraph().invoke({
    task: state.semanticTask,
  });
  
  Logger.log(`Edit cube graph result: ${result.finalResult}`);
  //TODO: Inform frontend user that the result is OK.
  
  return {
    ...state,
  };
}
*/
// DataRecoveryGraph Class
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];
  private company_name: string;

  constructor(company_name: string, functions: Function[]) {
    const graphState: StateGraphArgs<DataRecoveryState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      examples: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      cubeQuery: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      explanation: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      resultStatus: {
        value: (x: 'correct' | 'maybe' | 'incorrect', y?: 'correct' | 'maybe' | 'incorrect') => (y ? y : x),
        default: () => 'incorrect',
      },
      feedbackMessage: {
        value: (x: string | null, y?: string | null) => (y ? y : x),
        default: () => null,
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      title: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      displayType: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      description: {
        value: (x: string[], y?: string[]) => (y ? y : x),
        default: () => [],
      },
      resultExecution: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      needsSemanticUpdate: {
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
      semanticTask: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      queryAttempts: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
    };
    super(graphState);
    this.functions = functions;
    this.company_name = company_name;
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('recover_sources', async state => await recoverSources(state, this.company_name, this.functions))
      .addEdge(START, 'recover_sources')
      .addEdge('recover_sources', END);
      /*.addNode('edit_cube_graph', async state => await handleEditCubeGraph(state, this.functions, this.company_name))
      .addNode('create_cube_query', async state => await createCubeQuery(state, this.company_name, this.functions))
      .addNode('evaluate_result', async state => await evaluateResult(state, this.functions, this.company_name))
      .addNode('return_sql_description', async state => await returnSqlDescription(state, this.functions, this.company_name))
      .addEdge(START, 'recover_sources')
      //.addEdge('recover_sources', 'create_cube_query')
      .addConditionalEdges('recover_sources', state => {
        if (state.needsSemanticUpdate) {
          return 'edit_cube_graph';
        } else {
          return 'create_cube_query';
        }
      })
      .addEdge('edit_cube_graph', 'create_cube_query')
      .addConditionalEdges('create_cube_query', state => {
        if (state.queryAttempts > 3) {
          return END;
        } else {
          return 'evaluate_result';
        }
      })
      .addConditionalEdges('evaluate_result', state => {
        if (state.resultStatus === 'correct' || state.resultStatus === 'maybe') { // TODO: Create a working path for maybe, right now it enters an infinite loop if data is empty
          return 'return_sql_description';
        } else {
          return 'create_cube_query';
        }
      })
      .addEdge('return_sql_description', END);*/

    return subGraphBuilder.compile();
  }
}
