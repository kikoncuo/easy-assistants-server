import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, getRelevantTables } from './nodes/cardLogic';
import { getDatasetQuery } from '../utils/MetabaseAPI';
import { HumanMessage } from '@langchain/core/messages';
import { createStructuredResponseAgent, getStrongestModel } from '../models/Models';
import Logger from '../utils/Logger';
import { GeneratePlanTool } from '../models/Tools';
import { createThread, createMessage, streamRun, parseAndUploadTables, pollRun, saveOpenAIImage } from '../utils/AssitantsOpenAI';
import OpenAI from 'openai';

type MessageType = 'Image' | 'Text' | 'Code';

interface InsightExtractorState extends BaseState {
  task: string;
  schema: any[];
  sessionToken: string;
  queryResult: any;
  fieldDetails: Record<number, any>; 
  isPossible: string;
  relevantTables: any[];
  plan: any[];
  finalResult: string; 
  threadId: string;
}

export class InsightExtractorGraph extends AbstractGraph<InsightExtractorState> {
  private database: number;
  private companyName: string;
  private functions: Function[];

  constructor(databaseId: number, functions: Function[], companyName: string) {
    const graphState: StateGraphArgs<InsightExtractorState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      schema: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      sessionToken: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      queryResult: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
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
      threadId: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
    };
    super(graphState);
    this.database = databaseId;
    this.companyName = companyName;
    this.functions = functions;
  }

  private async fetchSchemaNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const { sessionToken, schema } = await fetchSchema(this.companyName, this.database);
    return { ...state, sessionToken, schema };
  }

  private async identifyRelevantTablesNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const { relevantTables } = await getRelevantTables(state.task, state.schema);
    Logger.log('relevantTables',relevantTables)
    return { ...state, relevantTables };
  }

  private async getTablesNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const queryResults = [];

    for (const table of state.relevantTables) {
        const questionData = {
            datasetQuery: {
                database: this.database,
                type: "query",
                query: {
                    "source-table": table.id,
                    //"limit": 1000 // I think we are going to need a limit at some point
                }
            }
        };

        let retry = true;
        let tableResult;

        while (retry) {
            try {
                tableResult = await getDatasetQuery(this.companyName, state.sessionToken, questionData);

                if (tableResult && tableResult.via && tableResult.via.length > 0 && tableResult.via[0].status === "failed") {
                    Logger.log(`Query for table ${table.name} failed, retrying...`);
                } else {
                    retry = false; // Exit retry loop if no failure
                }

            } catch (error) {
                Logger.error(`Error querying table ${table.name}:`, error);
                retry = false; // Exit retry loop in case of an error
            }
        }

        if (tableResult && tableResult.data) {
            const colNames = tableResult.data.cols
                .map((col: any) => col.name)
                .map((colName: string) => colName.charAt(0).toUpperCase() + colName.slice(1));
            queryResults.push({ name: table.name, rows: tableResult.data.rows, columns: colNames });
        }
    }
    return { ...state, queryResult: queryResults };
}


  private async plannerNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const tables = state.queryResult.map((table: any) => ({
        tableName: table.name,
        rows: table.rows.slice(0,100),
        columns: table.columns
      }));
  
      const formattedTables = JSON.stringify(tables)
    
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePlanTool]);

    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        
        You are provided with several tables. Each table contains its name, rows of data, and column names.
        
        For each table, you will receive:
        tableName: The name of the table.
        rows: The actual data in the table.
        columns: The name of each column in the table.
        
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

  private async codeInterpreterNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    let threadId = state.threadId;

    if (!threadId) { // If there is no threadId create it and expect a plan and files
      threadId = await createThread();
      const tables = state.queryResult.map((table: any) => ({
        tableName: table.name,
        columns: table.columns,
        rows: table.rows
      }));
    
      const attachments = await parseAndUploadTables(tables);
    
      await createMessage(threadId, JSON.stringify(state.plan), attachments);
    } else { // If there is a threadId, we are continuing a plan we will just send the new task
      await createMessage(threadId, JSON.stringify(state.task), []);
    }
    
    const assistantId = "asst_W5Q66sX3XpEzD9X2LU4mCzo6";
  
    await streamRun(
      threadId,
      assistantId,
      async (tool) => {
        Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`)
        if(tool.outputs && tool.outputs.length > 0 && tool.outputs[0].type === 'image') {
          const openai = new OpenAI();

          const imageId = tool.outputs[0].image.file_id;
          // Retrieve the image data from OpenAI
          const response = await openai.files.content(imageId);

          // Extract the binary data from the Response object
          const imageData = await response.arrayBuffer();

          // Convert the binary data to a Buffer
          const imageDataBuffer = Buffer.from(imageData);
          this.sendImageAndTextToFrontend(imageDataBuffer, "Image");
        }
        this.sendImageAndTextToFrontend(tool.input, "Code");
      },
      async (content, snapshot) => {
        const imageFileId = content.file_id;
        // const imageDataBuffer = await saveOpenAIImage(imageFileId);
        Logger.log(`\nIMAGE PROCESSED > ${imageFileId}\n\n`);
      },
      (content, snapshot) => {
        this.sendImageAndTextToFrontend(content, "Text");
        Logger.log(`\nTEXT DONE > ${JSON.stringify(content, null, 2)}`);
      }
    );

    // await pollRun(
    //   threadId, 
    //   assistantId, 
    //   (tool) => Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`),
    //   (content, snapshot) => saveOpenAIImage(content.image_file.file_id), // TODO: create a private function to send the image to the frontend
    //   (content, snapshot) => Logger.log(`\nTEXT DONE > ${JSON.stringify(content, null, 2)}`)
    // );

    return {...state, threadId: threadId};
  } 

  private async sendImageAndTextToFrontend(value: string | Buffer, type: string): Promise<void> {
    const argumentKeyMap = {
      Image: 'generatedImages',
      Text: 'generatedTexts',
      Code: 'generatedCodes'
    };
  
    const getArguments = (type: MessageType, value: string | Buffer) => ({
      function_name: `get${type}`,
      arguments: {
        [argumentKeyMap[type]]: value
      }
    });
  
    const data = [getArguments(type as MessageType, value)];
  
    this.functions[0]('tool', data);
  }  

  getGraph(): CompiledStateGraph<InsightExtractorState> {
    const graphBuilder = new StateGraph<InsightExtractorState>({ channels: this.channels });
  
    graphBuilder
      .addNode("fetch_schema", this.fetchSchemaNode.bind(this))
      .addNode('select_tables', this.identifyRelevantTablesNode.bind(this))
      .addNode('get_tables', this.getTablesNode.bind(this))
      .addNode("plan_execution", this.plannerNode.bind(this))
      .addNode("generate_python_code", this.codeInterpreterNode.bind(this))
      .addEdge(START, "fetch_schema")
      .addConditionalEdges('fetch_schema', (state) => { // Now if there is a threadId from openai, we will go there directly
        if (state.threadId !== '') {
          return 'generate_python_code';
        } else {
          return 'select_tables';
        }
      })
      .addEdge('fetch_schema', 'select_tables')
      .addConditionalEdges('select_tables', (state) => {
        if (state.relevantTables.length >= 1) {
          return 'get_tables';
        } else {
          return END;
        }
      })
      .addEdge('get_tables', 'plan_execution')
      .addEdge('plan_execution', 'generate_python_code') 
      .addEdge("generate_python_code", END)
    return graphBuilder.compile();
  }

  getApp(): any {
    return this.getGraph();
  }
}
