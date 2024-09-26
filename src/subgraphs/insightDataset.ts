import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { getRelevantTables } from './nodes/cardLogic';
import { authenticate, getDatasetAsCSV, getDatasetQuery } from '../utils/MetabaseAPI';
import { HumanMessage } from '@langchain/core/messages';
import { createStructuredResponseAgent, getStrongestModel } from '../models/Models';
import Logger from '../utils/Logger';
import { GeneratePlanTool } from '../models/Tools';
import { createThread, createMessage, streamRun, uploadTables } from '../utils/AssistantsOpenAI';
import { createNodeResponse } from '../utils/NodeResponseUtils';
import { ConfigurationManager } from '../utils/ConfigurationManager';
import { PostgresSaver } from '../checkpoint/postgres';

type MessageType = 'Image' | 'Text' | 'Code';

interface InsightDatasetState extends BaseState {
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
  finalResult: string; 
}

export class InsightDatasetGraph extends AbstractGraph<InsightDatasetState> {
  private database: number;
  private companyName: string;
  private functions: Function[];
  private schema: any[];
  private sessionToken: string;

  constructor(databaseId: number, functions: Function[], companyName: string, schema: any[]) {
    const graphState: StateGraphArgs<InsightDatasetState>['channels'] = {
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
      }
    };
    super(graphState);
    this.database = databaseId;
    this.companyName = companyName;
    this.functions = functions;
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
        this.functions[0]('info', createNodeResponse('error', { message: "Sorry could not authenticate" }));
      }
    } catch (error) {
      console.error("Error fetching schema:", error);
      this.functions[0]('info', createNodeResponse('error', { message: "Error fetching schema" }));
    }
  }

  private async identifyRelevantTablesNode(state: InsightDatasetState): Promise<InsightDatasetState> {
    if(state.continued) {
        return {...state, isPossible: 'yes'};
    }
    const { relevantTables } = await getRelevantTables(state.task, this.schema, state.relevantTables, state.continued, state.result);
    const changeNeeded = relevantTables.filter(table => table.status === 'current').length === 0;
    if (relevantTables && relevantTables.length > 0 && !changeNeeded) {
      this.functions[0]('info', createNodeResponse('data', { message: "Relevant tables successfully retrieved", data: {relevantTables: relevantTables} }));
    } else if (relevantTables && relevantTables.length > 0 && changeNeeded) {
      this.functions[0]('info', createNodeResponse('data', { message: "Relevant tables are already retrieved", data: {relevantTables: relevantTables} }));
    } else {
        this.functions[0]('info', createNodeResponse('error', { message: "Relevant tables could not be retrieved" }));
    }
    Logger.log('relevantTables',relevantTables)
    const tablesNeeded = changeNeeded ? 'yes' : 'no';
    Logger.log('tablesNeeded', tablesNeeded)
    return { ...state, isPossible: tablesNeeded, relevantTables };
  }


  private async getTablesNode(state: InsightDatasetState): Promise<InsightDatasetState> {
    const tablesToQuery = state.relevantTables.filter(table => table.status === 'current');
    Logger.log('tablesToQuery', tablesToQuery)
    for (const table of tablesToQuery) {
        const questionData = {
            datasetQuery: {
                database: this.database,
                type: "query",
                query: {
                    "source-table": table.id,
                    "limit": 10
                }
            }
        };
        let retry = true;
        let tableResult;
        let retryCount = 0;
        while (retry) {
            try {
                tableResult = await getDatasetQuery(this.companyName, this.sessionToken, questionData);
                if (tableResult && tableResult.via && tableResult.via.length > 0 && tableResult.via[0].status === "failed") {
                  retryCount++;  
                  Logger.log(`Query for table ${table.name} failed, retry attempt ${retryCount}`);
                    this.functions[0]('info', createNodeResponse('error', { message: `Query for table ${table.name} couldn't be retrieved for network issues, retry attempt ${retryCount}...` }));
                } else {
                    retry = false; // Exit retry loop if no failure
                    this.functions[0]('info', createNodeResponse('data', { message: `Successfully retrieved data for table ${table.name}`, data: {tableName: table.name} }));
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
    return { ...state, queryResult: state.queryResult };
}

  private async plannerNode(state: InsightDatasetState): Promise<InsightDatasetState> {
    const tables = state.queryResult.map((table: any) => ({
        tableName: table.name,
        rows: table.rows,
        fields: table.fields
      }));
  
    const formattedTables = JSON.stringify(tables)
    
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePlanTool]);

    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        
        You are provided with several tables. Each table contains its name, 10 rows of data, and fields array which will contain the fieldName of the field, description of the field and additional details of the field which can be very useful for the query.
        
        For each table, you will receive:
        tableName: The name of the table.
        rows: The actual data in the table.
        fields: The fields of the table.
        
        table data: ${formattedTables}
  
        Create a detailed step-by-step plan to extract insights based on the task above. Your plan should be an array of steps, where each step includes:

        1. Step Name: A brief, descriptive name for the step.
        2. Description: A detailed description of what this step should accomplish.
        3. Transformations: Detail any data transformations required for this step (e.g., aggregations, filtering, or calculations).
        4. Visualization: If applicable, suggest an appropriate visualization (e.g., bar chart, scatter plot, line chart) for this step.
        5. Expected Insight: Describe the insight or information you expect to gain from this step.
  
        IMPORTANT: This plan will be used to generate Python code for each step. Ensure that each step is clear, concise, and can be translated into a single Python script.
        IMPORTANT: Choose columns that actually exist in the table and avoid columns that do not exist.
        IMPORTANT: The plan should be returned as a JSON array of step objects.
  
        Here's an example of how the plan should be structured:
  
        [
          {
            "stepName": "Identify Underperforming Products",
            "description": "Calculate the sales performance of each product over the past month and compare it to the previous month to identify underperforming products.",
            "transformations": [
              "Aggregate TotalSold by ProductId for the current month and the previous month",
              "Calculate the percentage change in TotalSold for each product"
            ],
            "visualization": "Bar chart showing the percentage change in sales for each product",
            "expectedInsight": "Identify the top 5 products with the largest decrease in sales"
          },
          {
            "stepName": "Analyze Time-based Patterns",
            "description": "Examine sales patterns across different days of the week and times of day to identify potential factors affecting product performance.",
            "transformations": [
              "Aggregate TotalSold by DayOfWeek and hour of day",
              "Calculate average sales for each product by day and hour"
            ],
            "visualization": "Heatmap showing sales intensity by day of week and hour",
            "expectedInsight": "Identify peak sales periods and any products that deviate from overall trends"
          }
        ]
  
        Please provide a similar plan tailored to the given task and data.
      `)
    ]);

    const { plan } = message.lc_kwargs.tool_calls[0].args;


    const userResponses = [];

    let planString = JSON.stringify(plan, null, 2);
      const userOptions = [
        {
          function_name: 'planReview',
          arguments: {
            planReview: `Here is a plan how we want to get insights for your task. Have a look at it. We will keep you updated on each step of the plan. Please review it and let us know if you have any questions or suggestions.`,
            plan: plan
          },
        },
      ];

      // Send options to user via WebSocket
      try {
        const response = await this.functions[0]('tool', userOptions);
        userResponses.push({ plan: planString, response: response.planReview });
      } catch (error) {
        Logger.error('Error sending plan to user:', error);
      }


    return {...state, plan: plan}
  }

  private async codeInterpreterNode(state: InsightDatasetState): Promise<InsightDatasetState> {
    let codeInterpreterThreadId = state.codeInterpreterThreadId;

    if(state.continued) {
        state.relevantTables = state.relevantTables.map(table => ({
          ...table,
          status: 'previous'
        }));
    }
    const tablesToQuery = state.relevantTables.filter(table => table.status === 'current');
    if (!codeInterpreterThreadId) { // If there is no codeInterpreterThreadId create it and expect a plan and files
      
      codeInterpreterThreadId = await createThread();

      const csvs = await this.getDatasetAsCSV(tablesToQuery, this.sessionToken, this.database, this.companyName);

      const attachments = await uploadTables(csvs);
    
      await createMessage(codeInterpreterThreadId, JSON.stringify(state.plan), attachments);
    
    } else { // If there is a codeInterpreterThreadId, we are continuing a plan we will just send the new task
      
      if(state.continued && tablesToQuery.length > 0) {
        
        const csvs = await this.getDatasetAsCSV(tablesToQuery, this.sessionToken, this.database, this.companyName);
        
        const attachments = await uploadTables(csvs);
        
        await createMessage(codeInterpreterThreadId, JSON.stringify(state.task), attachments);
     
      } else {
        
        await createMessage(codeInterpreterThreadId, JSON.stringify(state.task), []);
      }
    }
    
    if(!process.env.INSIGHT_ASSISTANT_KEY) {
      this.functions[0]('info', createNodeResponse('error', { message: "Insight assistant integration is not enabled. " }));
      return { ...state, codeInterpreterThreadId: codeInterpreterThreadId };
    }

    const assistantId = process.env.INSIGHT_ASSISTANT_KEY
  
    await streamRun(
      codeInterpreterThreadId,
      assistantId,
      async (tool, imageData, status, runId) => {

        Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`)
        if(imageData) {
          this.sendImageAndTextToFrontend(imageData, "Image", status, runId, codeInterpreterThreadId);
        }
        this.sendImageAndTextToFrontend(tool.input, "Code", status, runId, codeInterpreterThreadId);
      },
      (content, status, runId) => {

        this.sendImageAndTextToFrontend(content, "Text", status, runId);
        Logger.log(`\nTEXT DONE > ${JSON.stringify(content, null, 2)}`);
        if(status === 'completed') {
          state.result = content.value;
        }
      },
      (error) => {
        Logger.error('Error in streamRun:', error);
        this.functions[0]('info', createNodeResponse('error', { message: "There was an error with the AI models. Please contact with Omniloy support team.", data: { error: error } }));
      }
    );

    // await pollRun(
    //   codeInterpreterThreadId, 
    //   assistantId, 
    //   (tool) => Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`),
    //   (content, snapshot) => saveOpenAIImage(content.image_file.file_id), // TODO: create a private function to send the image to the frontend
    //   (content, snapshot) => Logger.log(`\nTEXT DONE > ${JSON.stringify(content, null, 2)}`)
    // );


    state.continued = true;
    Logger.log('continued', state.continued)

    return {...state, codeInterpreterThreadId: codeInterpreterThreadId};
  } 

  private async sendImageAndTextToFrontend(value: string | Buffer, type: string, status: string, runId: string, codeInterpreterThreadId?: string): Promise<void> {
    const argumentKeyMap = {
      Image: 'generatedImages',
      Text: 'generatedTexts',
      Code: 'generatedCodes'
    };
  
    const getArguments = (type: MessageType, value: string | Buffer, status: string, runId:string, codeInterpreterThreadId?: string) => {
      const args: any = {
        [argumentKeyMap[type]]: value,
        status: status,
        runId: runId
      };
  
      if ((type === 'Image' || type === 'Code') && codeInterpreterThreadId) {
        args.codeInterpreterThreadId = codeInterpreterThreadId;
      }
  
      return {
        function_name: `get${type}`,
        arguments: args
      };
    };
  
    const data = [getArguments(type as MessageType, value, status, runId, codeInterpreterThreadId)];
  
    this.functions[0]('tool', data);
  }

  private async getDatasetAsCSV(relevantTables:any[], sessionToken: string, databaseID:number, companyName:string): Promise<any> {
    const csvs: { [tableName: string]: string } = {};
    for(const table of relevantTables) {
      let retry = true;
      let retryCount = 0;
      let csv;
    //   const query = table.dataset_query
      const payload = {
        query: JSON.stringify({
            database: databaseID,
            query: { "source-table": table.id, limit: 10000 },
            type: "query"
          })
      };
      while (retry) {
        try {
            csv = await getDatasetAsCSV(companyName, payload, sessionToken);
            if (csv && csv.via && csv.via.length > 0 && csv.via[0].status === "failed") {
              retryCount++;  
              Logger.log(`CSV for table ${table.name} failed, retry attempt ${retryCount}`);
              this.functions[0]('info', createNodeResponse('data', { message: `Table ${table.name} couldn't be retrieved for network issues, retry attempt ${retryCount}...` }));
            } else {
              retry = false; // Exit retry loop if no failure
              this.functions[0]('info', createNodeResponse('data', { message: `Successfully retrieved table ${table.name}`, data: {csv: table.name} }));
            }
          } catch (error) {
            console.error(`Error fetching CSV for table ${table.name}:`, error);
          retry = false; // Exit retry loop in case of an error
        }
      }
        csvs[table.name] = csv;
    }
    return csvs;
  }

  getGraph(): CompiledStateGraph<InsightDatasetState> {
    const graphBuilder = new StateGraph<InsightDatasetState>({ channels: this.channels });
    const clientConfig = ConfigurationManager.getConfig(this.companyName);

    graphBuilder
      .addNode('select_tables', this.identifyRelevantTablesNode.bind(this))
      .addNode('get_tables', this.getTablesNode.bind(this))
      .addNode("plan_execution", this.plannerNode.bind(this))
      .addNode("generate_python_code", this.codeInterpreterNode.bind(this))
      .addEdge(START, "select_tables")
      .addConditionalEdges('select_tables', (state) => { // Now if there is a threadId from openai, we will go there directly
        if (state.codeInterpreterThreadId !== '' && state.isPossible === 'yes') {
          return 'generate_python_code';
        } 
        if (state.relevantTables.length >= 1 && state.isPossible === 'no' && state.continued === false) {
          return 'get_tables';
        } else {
            return END;
        }
      })
      .addConditionalEdges('get_tables', (state) => {
        if (state.continued === true) {
          return 'generate_python_code';
        } else {
          return 'plan_execution';
        }
      })
      .addEdge('plan_execution', 'generate_python_code') 
      .addEdge("generate_python_code", END)
    
      
      const poolConfig = {
        host: clientConfig.PG_HOST,
        port: Number(clientConfig.PG_PORT),
        user: clientConfig.PG_USER,
        password: clientConfig.PG_PASSWORD,
        database: clientConfig.PG_DATABASE,
      };
      
      const postgresSaver = new PostgresSaver(poolConfig);

    return graphBuilder.compile({ checkpointer: postgresSaver });
  }

  getApp(): any {
    return this.getGraph();
  }
}