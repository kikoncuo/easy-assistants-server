import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet, groqChatLlama } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import fs from 'fs';
import path from 'path';
import { executeQuery } from '../utils/DataStructure';

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
}

function readModels(): string[] {
  const modelsDirectory = path.join(__dirname, 'cubes');
  const files = fs.readdirSync( modelsDirectory );
  return files.map(file => fs.readFileSync(path.join(modelsDirectory, file), 'utf-8'));
}

function filterModels(models: string[], sources: string[]): string[] {
  return models.filter(model => {
    return sources.some(source => model.includes(`cube(\`${source}\``));
  });
}

// Node function to recover sources
async function recoverSources(
  state: DataRecoveryState,
): Promise<DataRecoveryState> {
  const cubeModels = readModels();

  const getSources = z.object({
    sources: z.array(z.string()).describe('Array with the names of the sources'),
    isPossible: z
      .string()
      .describe(
        '"true" if the data recovery is possible based on the sources provided, "maybe" if you need more examples of the tables, false if you don\'t think the question is answerable',
      ),
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getSources);

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided model descriptions and examples,
        and determine which data sources could be useful in addressing the request.

        First, review the following model descriptions to know the dimensions and measures available:
        ${cubeModels.join('\n')}
        Now, consider the following request:
        ${state.task}
        
        Keep in mind that multiple data sources may be relevant to a single request.
        If a data source seems even slightly relevant to the request, include it in your list.
        `),
  ]);

  const sources = (message as any).sources;
  const isPossible = (message as any).isPossible;
  Logger.log('\nisPossible', isPossible);
  Logger.log('\nsources', sources);

  const updatedState = {
    ...state,
    examples: sources,
  };

  if (isPossible === 'false') {
    updatedState.finalResult = "It wasn't possible to resolve the query with the available data.";
    return updatedState;
  }

  return updatedState;
}

// Node function to create Cube query
async function createCubeQuery(state: DataRecoveryState): Promise<DataRecoveryState> {
  const getCubeQuery = z.object({
    assumptions: z
      .string()
      .optional()
      .describe(
        "Assumptions we made about what the user said vs how we built the query. The assumptions need to be understood by a non technical person who doesn't know the details of the database.",
      ),
    cubeQuery: z.string()
      .describe(`Cube query that returns a table which satisfies the task and is readable by a non-technical person.
        Make the query efficient leveraging Cube features. Always return all the results without limit.
        Provide insightful queries, avoid simple logic unless asked to, the results of your queries will be evaluated by business and marketing experts.
        Query structure example:
        {
          "measures": [
            "Product.count"
          ],
          "dimensions": [
            "Product.group"
          ],
          "order": {
            "Product.count": "desc"
          }
        }`),
    description: z.string().describe('Task simple description, in a simple phrase.'),
    title: z
      .string()
      .describe(
        'Task title, IE: create a chart for my top 5 beans based on price, the title returned should be `Top 5 Whole Bean/Teas Products by Price`. ',
      ),
    displayType: z
      .enum(['table', 'barChart', 'doghnutChart', 'lineChart', 'dataPoint'])
      .describe('Type of display for the query result. It can be either table, barChart, doghnutChart, or lineChart.'),
  });
  
  const cubeModels = readModels();
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

    const resultExecution = await executeQuery(state.cubeQuery, 'omni_test'); //await functions[0]('tool', getCubeQuery);

    const message = await model.invoke([
      new HumanMessage(`Based on the following user request:
                ${state.task}
                Given the following Cube query,
                ${state.cubeQuery}
                Which returned the following results (limit 10):
                ${resultExecution}
                Evaluate the Cube query result:
                - 'correct' if the results from the query look correct, solve the task, and are consistent and logical.
                - 'maybe' if you're not sure and need more information or exploration.
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
    if (resultStatus === 'correct') {
      functions[0]('tool', getCubeQuery);
    }

    return {
      ...state,
      resultStatus: resultStatus,
      feedbackMessage: feedbackMessage,
      finalResult: resultStatus === 'correct' ? state.cubeQuery : '',
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

// DataRecoveryGraph Class
export class DataRecoveryGraph extends AbstractGraph<DataRecoveryState> {
  private functions: Function[];

  constructor(functions: Function[], prefixes: string, connectionChain?: string) {
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
    };
    super(graphState);
    this.functions = functions;
  }

  getGraph(): CompiledStateGraph<DataRecoveryState> {
    const subGraphBuilder = new StateGraph<DataRecoveryState>({ channels: this.channels });

    subGraphBuilder
      .addNode(
        'recover_sources',
        async state => await recoverSources(state),
      )
      .addNode('create_cube_query', async state => await createCubeQuery(state))
      .addNode('evaluate_result', async state => await evaluateResult(state, this.functions))
      .addEdge(START, 'recover_sources')
      .addConditionalEdges('recover_sources', state => {
        if (state.finalResult) {
          return END;
        } else {
          return 'create_cube_query';
        }
      })
      .addEdge('create_cube_query', 'evaluate_result')
      .addConditionalEdges('evaluate_result', state => {
        if (state.resultStatus === 'correct') {
          return END;
        } else {
          return 'create_cube_query';
        }
      });

    return subGraphBuilder.compile();
  }
}
