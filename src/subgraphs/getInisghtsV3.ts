import axios from 'axios';
import { AbstractGraph, BaseState } from './baseGraph';
import { END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { getCode, getRelevantTables, getReport, startKernel } from './nodes/insightLogic';
import { authenticate, getDatasetQuery } from '../utils/MetabaseAPI';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import Logger from '../utils/Logger';
import { createNodeResponse } from '../utils/NodeResponseUtils';
import { ConfigurationManager } from '../utils/ConfigurationManager';
import { PostgresSaver } from '../checkpoint/postgres';
import { MemorySaver } from '@langchain/langgraph';
import { getPlan } from './nodes/insightLogic';
import { LLMResponseHandler } from '../utils/LLMResponseHandler';
export interface InsightDatasetStateV3 extends BaseState {
  messages: (HumanMessage | AIMessage | SystemMessage)[];
  task: string;
  queryResult: any[];
  fieldDetails: Record<number, any>; 
  isPossible: string;
  relevantTables: any[];
  plan: any[];
  codeInterpreterThreadId: string; 
  runId: string; 
  continued: boolean;
  result: string;
  planDone: boolean;
  codeDone: boolean;
  limit: number;
  code: any[];
  cellCount: number;
  summary: any[];
  kernelId: any
  finalResult: string; 
}

export class InsightDatasetGraphV3 extends AbstractGraph<InsightDatasetStateV3> {
  private database: number;
  private companyName: string;
  private llmResponseHandler: LLMResponseHandler;
  private functions: Function[];
  private schema: any[];
  private sessionToken: string;

  constructor(databaseId: number, functions: Function[], companyName: string, schema: any[]) {
    const graphState: StateGraphArgs<InsightDatasetStateV3>['channels'] = {
      messages: {
        value: (
          x: (HumanMessage | AIMessage | SystemMessage)[],
          y: (HumanMessage | AIMessage | SystemMessage)[]
        ) => x.concat(y),
        default: () => [],
      },
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      queryResult: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      fieldDetails: {  
        value: (x: Record<number, any>, y?: Record<number, any>) => (y ? y : x),
        default: () => ({}),
      },
      isPossible: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      relevantTables: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      plan: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      codeInterpreterThreadId: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      runId: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      continued: {
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
      result: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      planDone: {
        value: (x: boolean, y?: boolean) => (typeof y === 'boolean' ? y : x),
        default: () => false,
      },
      limit: {
        value: (x: number, y?: number) => (typeof y === 'number' ? y : x),
        default: () => 10
      },
      code: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      cellCount: {
        value: (x: number, y?: number) => (typeof y === 'number' ? y : x),
        default: () => 1
      },
      codeDone: {
        value: (x: boolean, y?: boolean) => (typeof y === 'boolean' ? y : x),
        default: () => false,
      },
      summary: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      kernelId: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => ''
      },
    };
    super(graphState);
    this.database = databaseId;
    this.companyName = companyName;
    this.functions = functions;
    this.llmResponseHandler = new LLMResponseHandler(functions);
    this.sessionToken = '';
    this.schema = schema;
  }

  async initialize(): Promise<void> {
    try {
      const sessionToken = await authenticate(this.companyName);
      this.sessionToken = sessionToken;
      if (sessionToken) {
        Logger.log('Authenticated successfully');
      } else {
        this.functions[1]('info', createNodeResponse('error', { message: "Sorry could not authenticate" }));
      }
    } catch (error) {
      console.error("Error fetching schema:", error);
      this.functions[1]('info', createNodeResponse('error', { message: "Error fetching schema" }));
    }
  }

  private async identifyRelevantTablesNode(state: InsightDatasetStateV3): Promise<InsightDatasetStateV3> {
    if(state.continued) {
        return {...state, isPossible: 'yes'};
    }
    const systemPrompt = `You are an expert database schema analyst specializing in identifying relevant tables and relationships for a specific task. 
    Your role is to analyze a given database schema and determine which tables are most relevant for accomplishing a specified task.
    Here is the schema: ${JSON.stringify(this.schema, null, 2)}
    Here is the task: ${state.task}
    `;
    state.messages = await this.llmResponseHandler.initializeMessages(state.task, systemPrompt, state.messages);
    const { state: updatedState, response } = await getRelevantTables(state,this.llmResponseHandler);
    state = { ...state, ...updatedState };
    return { ...state, ...response };
  }


  private async getTablesNode(state: InsightDatasetStateV3): Promise<InsightDatasetStateV3> {
    for (const table of state.relevantTables) {
        const questionData = {
            datasetQuery: {
                database: this.database,
                type: "query",
                query: {
                    "source-table": table.id,
                    "limit": state.limit
                }
            }
        };
        let retry = true;
        let maxRetryCount = 3;
        let tableResult;
        let retryCount = 0;
        while (retry && retryCount < maxRetryCount) {
            try {
                tableResult = await getDatasetQuery(this.companyName, this.sessionToken, questionData);
                if (tableResult && tableResult.via && tableResult.via.length > 0 && tableResult.via[0].status === "failed") {
                  retryCount++;  
                  Logger.log(`Query for table ${table.name} failed, retry attempt ${retryCount}`);
                    this.functions[1]('info', createNodeResponse('error', { message: `Query for table ${table.name} couldn't be retrieved for network issues, retry attempt ${retryCount}...` }));
                    if (retryCount >= maxRetryCount) {
                        retry = false; // Exit retry loop if max retry count is reached
                        this.functions[1]('error', createNodeResponse('error', { 
                            message: `Failed to retrieve data for table ${table.name} after ${retryCount} attempts.` 
                        }));
                    } 
                } else {
                    retry = false; // Exit retry loop if no failure
                    this.functions[1]('info', createNodeResponse('data', { message: `Successfully retrieved data for table ${table.name}`, data: {tableName: table.name} }));
                }
            } catch (error) {
                Logger.error(`Error querying table ${table.name}:`, error);
                retry = false; // Exit retry loop in case of an error
            }
        }
        if (tableResult && tableResult.data) {
          const filteredSchema = this.schema.filter((schema) => schema.id === table.id);
          const fields = filteredSchema.map((i: any) => i.fields).flat(1);
          fields.forEach((field: any) => {
            delete field.id
            delete field.name
          });
          state.queryResult.push({ name: table.name, rows: tableResult.data.rows, fields: fields });
        }
    }
    state.messages = []
    state.cellCount = state.relevantTables.length + 1;
    return { ...state, queryResult: state.queryResult, messages: state.messages, cellCount: state.cellCount };
  }

  private async plannerNode(state: InsightDatasetStateV3): Promise<InsightDatasetStateV3> {

    const tables = state.queryResult.map((table: any) => ({
        tableName: table.name,
        rows: table.rows,
        fields: table.fields
      }));
    
    const formattedTables = JSON.stringify(tables)

    const systemPrompt = `You are a technical business analyst that makes plans.
          You are provided with several tables. Each table contains its name, 10 rows of data, and fields array which will contain the fieldName of the field, description of the field and additional details of the field which can be very useful.
        
            For each table, you will receive:
            tableName: The name of the table.
            rows: The actual data in the table.
            fields: The fields of the table.
            
            table data: ${formattedTables}
          
          Please note: Your responses should be adaptable as users may request plan updates or modifications based on their needs.`

      state.messages = await this.llmResponseHandler.initializeMessages(state.task, systemPrompt, state.messages);
      const toolHandlers = {
        planFinished: async (args: any, toolCallId: string, state: any) => {
          console.log('Plan finished');
          return { planDone: true };
        },
      };
      const { state: updatedState, response } = await getPlan(state,this.llmResponseHandler, toolHandlers);
      state = { ...state, ...updatedState };
      return { ...state, ...response };
  }

  private async jupyCellNode(state: InsightDatasetStateV3): Promise<InsightDatasetStateV3> {
    if(!state.kernelId) {
       state.messages = []
       state.kernelId = await startKernel(state, this.companyName, this.sessionToken, this.database);
    }
    state.codeDone = true;

    const tables = state.queryResult.map((table: any) => ({
      tableName: table.name,
      rows: table.rows,
      fields: table.fields
    }));
  
    const formattedTables = JSON.stringify(tables)
    const systemPrompt = 
    `You are ChatGPT, a large language model trained by OpenAI.
     You are expert in Python programming and data analysis.
     Your task is to generate executable Python code based on the provided dataset preview and plan.
     For each table in the dataset:
      - tableName: The name of the table
      - rows: Sample data (10 rows) from the table
      - fields: The fields/columns of the table

     Dataset Preview: ${formattedTables}
     Plan: ${JSON.stringify(state.plan, null, 2)}
     REQUIREMENTS:
      1. Generate clear, efficient, and executable Python code
      2. Focus on data manipulation, analysis, and visualization
      3. Ensure all code is compatible with a Jupyter notebook environment
      4. The complete dataset for each table is already loaded in the kernel named in a variable named according to the table name. example: weather
      5. The variable names will be in the LowerCase.
      6. Use StringIO to read the dataset CSV string into a DataFrame. example: weather_data = pd.read_csv(StringIO(weather)) 
      7. Use the actual table names from the preview for data manipulation

    IMPORTANT: The preview only shows 10 rows per table, but your code should work with the full datasets available in the kernel.
    ADDITIONAL REQUIREMENTS:
      1. After each step of data manipulation, display the results using appropriate functions like print, head(), or summary statistics functions.
      2. Ensure that the code provides meaningful insights or results in addition to visualizations. For example, calculate and display averages, sums, correlations, or other metrics based on the dataset.
     `
     state.messages = await this.llmResponseHandler.initializeMessages(state.task, systemPrompt, state.messages);
     const toolHandlers = {
      generateCode: async (args: any, toolCallId: string, state: any) => {
        state.code = [args.pythonCode];
        let result;
        
      let cellCount = state.cellCount;
      state.cellCount++;
      for (let i = 0; i < state.code.length; i++) {
        let code = state.code[i];
        const codeCellResponse = await axios.post('http://localhost:8000/cell', {
            kernel_id: state.kernelId,
            cell_number: cellCount,
            code: code, 
            action: 'add'
        });
        console.log(`state.code ${i}`, code);
        Logger.log(`codeCellResponse.data ${cellCount}`,codeCellResponse.data); 
  
        const runCellResponse = await axios.post('http://localhost:8000/cell', {
            kernel_id: state.kernelId,
            cell_number: cellCount, 
            action: 'run'
        });
        cellCount++;
        const cellOutputs = runCellResponse.data.outputs;
      if (cellOutputs.length > 0) {
        for (let i = 0; i < cellOutputs.length; i++) {
          if (cellOutputs[i].data && cellOutputs[i].data['image/png']) {
                let imageData = cellOutputs[i].data['image/png'];
                const generateImages = [
                  {
                    function_name: 'generateImages',
                    arguments: {
                      generatedImages: imageData
                    }
                  },
                ];
                this.functions[1]('tool', generateImages);
            }
            if(cellOutputs[i].name && cellOutputs[i].name === 'stdout') {
              state.summary = [...state.summary, cellOutputs[i].text];
              result = cellOutputs[i].text;
            }
          }
        }
      
       const generateCode = [
        {
          function_name: 'generateCode',
          args: {
            pythonCode: args.pythonCode,
            explanation: args.explanation
          }
        },
      ];
      this.functions[1]('tool', generateCode);
      }
        return { code: result };
      },
      codeFinished: async (args: any, toolCallId: string, state: any) => {
        console.log('code execution finished');
        return { codeDone: true };
      },
    };
     const { state: updatedState, response } = await getCode(state,this.llmResponseHandler, toolHandlers);
     state = { ...state, ...updatedState };
     return { ...state, ...response };
  }

  private async reportWriterNode(state: InsightDatasetStateV3): Promise<InsightDatasetStateV3> {
    state.messages = []
    const systemPrompt = `You are a technical business analyst that writes reports.
    Your role is to write a report based on the given task, plan and result.
    Here is the task: ${state.task}
    Here is the plan: ${JSON.stringify(state.plan, null, 2)}
    Here is the result: ${JSON.stringify(state.summary, null, 2)}
`
     state.messages = await this.llmResponseHandler.initializeMessages(state.task, systemPrompt, state.messages);
     const { state: updatedState, response } = await getReport(state,this.llmResponseHandler);
     state = { ...state, ...updatedState };
     return { ...state, ...response };
  }
  

  getGraph(): any {
    const graphBuilder = new StateGraph<InsightDatasetStateV3>({ channels: this.channels });
    const clientConfig = ConfigurationManager.getConfig(this.companyName);

    graphBuilder
      .addNode('select_tables', this.identifyRelevantTablesNode.bind(this))
      .addNode('get_tables', this.getTablesNode.bind(this))
      .addNode("plan_execution", this.plannerNode.bind(this))
      .addNode("generate_python_code", this.jupyCellNode.bind(this))
      .addNode("report_writer", this.reportWriterNode.bind(this))
      .addEdge(START, "select_tables")
      .addConditionalEdges('select_tables', (state) => { // Now if there is a threadId from openai, we will go there directly
        if (state.codeInterpreterThreadId !== '' && state.relevantTables.length > 0) {
          return 'generate_python_code';
        } 
        if (state.relevantTables.length > 0) {
          return 'get_tables';
        } else {
          return "select_tables"
        }
      })
      .addConditionalEdges('get_tables', (state) => {
        if (state.continued === true) {
          return 'generate_python_code';
        } else {
          return 'plan_execution';
        }
      })
      .addConditionalEdges('plan_execution', (state) => {
        if (state.planDone === true) {
          return "generate_python_code";
        } else {
          return 'plan_execution';
        }
      })
      .addConditionalEdges('generate_python_code', (state) => {
        if (state.codeDone === true) {
          return "report_writer";
        } else {
          return 'generate_python_code';
        }
      })
      .addEdge('report_writer', END)
      
      const poolConfig = {
        host: clientConfig.PG_HOST,
        port: Number(clientConfig.PG_PORT),
        user: clientConfig.PG_USER,
        password: clientConfig.PG_PASSWORD,
        database: clientConfig.PG_DATABASE,
      };
      
      const postgresSaver = new PostgresSaver(poolConfig);
      const memory = new MemorySaver();

    return graphBuilder.compile({ checkpointer: memory });
  }

  getApp(): any {
    return this.getGraph();
  }
}