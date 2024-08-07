import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { executeQuery, getModelsData, getSQLQuery } from '../utils/DataStructure';
import { EditCubeGraph } from './editCubes';

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
}

async function getModels(company_name: string): Promise<string[]> {
  return await getModelsData(company_name);
}

function filterModels(models: string[], sources: string[]): string[] {
  const parsedModels = models.map(model => JSON.parse(model));
  const filteredModels = parsedModels.filter(model => {
    return sources.includes(model.name);
  });
  return filteredModels.map(model => JSON.stringify(model));
}

// Node function to recover sources
async function recoverSources(
  state: DataRecoveryState,
  company_name: string
): Promise<DataRecoveryState> {
  const cubeModels = await getModels(company_name);

  const getSources = z.object({
    sources: z.array(z.string()).describe('Array with the names of the sources'),
    isPossible: z
      .string()
      .describe(
        '"true" if the data recovery is possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable',
      ),
    needsSemanticUpdate: z
      .boolean()
      .describe('Whether a semantic layer update is needed for the task.'),
    semanticTask: z
      .string()
      .optional()
      .describe('Specific measure or dimension to create on the semantic layer if needed.'),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getSources);

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

  const sources = (message as any).sources;
  const isPossible = (message as any).isPossible;
  const needsSemanticUpdate = (message as any).needsSemanticUpdate;
  const semanticTask = (message as any).semanticTask || '';

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
    updatedState.finalResult = "It wasn't possible to resolve the query with the available data.";
    return updatedState;
  }

  return updatedState;
}

// Node function to create Cube query
async function createCubeQuery(state: DataRecoveryState, company_name: string): Promise<DataRecoveryState> {
  const getCubeQuery = z.object({
    assumptions: z
      .string()
      .optional()
      .describe(
        "Assumptions we made about what the user said vs how we built the query. The assumptions need to be understood by a non technical person who doesn't know the details of the database.",
      ),
    cubeQuery: z.string() // TODO: Time dimensions don't work yet we need to fix this and add it to the example
      .describe(`Cube query that returns a table which satisfies the task.
        Provide insightful queries, avoid simple logic unless asked to, the results of your queries will be evaluated by business and marketing experts.
        Query structure example with all available options:
        {
          "dimensions": [
            "cube1.param1",
            "cube1.param2",
            "cube2.param1"
          ],
          "measures": [
            cube1.param5,
            cube4.param2,
            cube3.param1,
          ],
          "filters": [
            {
              "member": "cube6.param1",
              "operator": "beforeDate",
              "values": ["2023-12-31"]
            }
          ],
          "segments": [
            "cube1.segment1"
          ],
          "order": [
            ["cube1.param1", "desc"]
          ]
        }
        `),
    description: z.string().describe('Task simple description, in a simple phrase.'),
    title: z
      .string()
      .describe(
        'Task title, IE: create a chart for my top 5 beans based on price, the title returned should be `Top 5 Whole Bean/Teas Products by Price`. ',
      ),
    displayType: z
      .enum(['table', 'barChart', 'doghnutChart', 'lineChart', 'dataPoint'])
      .describe('Type of display for the query result. It can be either table, barChart, doghnutChart, lineChart, or dataPoint.'),
  });
  
  const cubeModels = await getModels(company_name);
  const filteredCubeModels = filterModels(cubeModels, state.examples);

  const model = createStructuredResponseAgent(anthropicSonnet(), getCubeQuery);
  const messageContent = `Based on the following sources
        ${filteredCubeModels}
        please provide a Cube query that returns a table that satisfies the following task:
        ${state.task}
        For displayType charts (barChart, doghnutChart, lineChart), the query should only return 2 columns, one for labels and one for values.
        For tables, the query should include a date column.

       ${state.feedbackMessage ? `Previous attempt resulted in an error: ${state.feedbackMessage}\nPlease adjust the query to avoid this error` : ''}`;
       

  const message = await model.invoke(messageContent);
  const cubeQuery = (message as any).cubeQuery;
  const assumptions = (message as any).assumptions;
  const description = (message as any).description;
  const title = (message as any).title;
  const displayType = (message as any).displayType;

  Logger.log('cubeQuery', cubeQuery);
  Logger.log('assumptions', assumptions);

  //const resultExecution = await executeQueries([cubeQuery]);

  return {
    ...state,
    cubeQuery: cubeQuery,
    explanation: assumptions,
    description: description,
    title: title,
    displayType: displayType,
    //resultExecution: resultExecution
  };
}

// Node function to evaluate result
async function evaluateResult(
  state: DataRecoveryState,
  functions: Function[],
  company_name: string
): Promise<DataRecoveryState> {
  

  try {
    const getFeedback = z.object({
      resultStatus: z.enum(['correct', 'maybe', 'incorrect']).describe('Evaluation of the query result'),
      feedbackMessage: z
        .string()
        .optional()
        .describe('Feedback message if the query was incorrect or needs further exploration.'),
    });

    const model = createStructuredResponseAgent(anthropicSonnet(), getFeedback);

    const resultExecution = await executeQuery(state.cubeQuery, company_name); //await functions[0]('tool', getCubeQuery);

    console.log('\n\nresultExecution', JSON.parse(resultExecution).data);
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
    
    const resultStatus = (message as any).resultStatus;
    const feedbackMessage = (message as any).feedbackMessage || '';

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
    const getFeedback = z.object({
      description: z.string().describe('Description on how the SQL query is solving the initial task'),
    });

    const sqlQuery = await getSQLQuery(company_name, state.cubeQuery);

    const model = createStructuredResponseAgent(anthropicSonnet(), getFeedback);
    const message = await model.invoke([
      new HumanMessage(`Based on the following user request 
                ${state.task},
                the SQL query to solve the task is 
                ${sqlQuery}.
                
                Describe how the SQL has solved the initial request.
            `),
    ]);
    
    const description = (message as any).description;

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
  Logger.log(`Edit cube graph result: ${result}`);
  return {
    ...state,
    ...result,
  };
}

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
    };
    super(graphState);
    this.functions = functions;
    this.company_name = company_name;
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode('recover_sources', async state => await recoverSources(state, this.company_name))
      //.addNode('edit_cube_graph', async state => await handleEditCubeGraph(state, this.functions, this.company_name))
      .addNode('create_cube_query', async state => await createCubeQuery(state, this.company_name))
      .addNode('evaluate_result', async state => await evaluateResult(state, this.functions, this.company_name))
      .addNode('return_sql_description', async state => await returnSqlDescription(state, this.functions, this.company_name))
      .addEdge(START, 'recover_sources')
      .addEdge('recover_sources', 'create_cube_query')
      /*.addConditionalEdges('recover_sources', state => {
        if (state.needsSemanticUpdate) {
          return 'edit_cube_graph';
        } else {
          return 'create_cube_query';
        }
      })
      .addEdge('edit_cube_graph', 'create_cube_query')*/
      .addEdge('create_cube_query', 'evaluate_result')
      .addConditionalEdges('evaluate_result', state => {
        if (state.resultStatus === 'correct' || state.resultStatus === 'maybe') { // TODO: Create a working path for maybe, right now it enters an infinite loop if data is empty
          return 'return_sql_description';
        } else {
          return 'create_cube_query';
        }
      })
      .addEdge('return_sql_description', END);

    return subGraphBuilder.compile();
  }
}
