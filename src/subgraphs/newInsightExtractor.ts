import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, getRelevantTables } from './nodes/cardLogic';
import { getDatasetQuery } from '../utils/MetabaseAPI';
import { HumanMessage } from '@langchain/core/messages';
import { createStructuredResponseAgent, getFasterModel, getStrongestModel } from '../models/Models';
import Logger from '../utils/Logger';
import { getCodeInterpreterInstance, runCodeInterpret } from '../utils/codeInterpreter';
import { GenerateFixedCodeTool, GeneratePlanTool, GeneratePythonCodeTool } from '../models/Tools';
import fs from 'fs'; // Just for testing, delete this and path later, and add the code to send the image to the frontend
import path from 'path';

interface InsightExtractorState extends BaseState {
  task: string;
  schema: any[];
  sessionToken: string;
  codeId: number;
  queryResult: any;
  pythonCode: any[]; 
  codeExplanation: string;
  insight: string;
  fieldDetails: Record<number, any>; 
  isPossible: string;
  relevantCards: any[]; 
  newCardDescription: string;
  insightsData: any[]; 
  queryAttempts: number;
  stopExecution: boolean;
  feedbackMessage: string;
  relevantTables: any[];
  plan: any[];
  errorCodes: any[];
  errorMessages: any[];
  errorCodeIds: number[]
  pythonCodeIds: number[];
  finalResult: string;  
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
      codeId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      queryResult: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      pythonCode: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      insight: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      codeExplanation: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      fieldDetails: {  
        value: (x: Record<number, any>, y?: Record<number, any>) => (y ? y : x),
        default: () => ({}),
      },
      relevantCards: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      isPossible: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      newCardDescription: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      insightsData: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      queryAttempts: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      stopExecution: {  
        value: (x: boolean, y?: boolean) => (y ? y : x),
        default: () => false,
      },
      feedbackMessage: {
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
      errorCodes: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      errorMessages: {
        value: (x: any[], y?: any[]) => (y ? y : x),
        default: () => [],
      },
      pythonCodeIds: {
        value: (x: number[], y?: number[]) => (y ? y : x),
        default: () => [],
      },
      errorCodeIds: {
        value: (x: number[], y?: number[]) => (y ? y : x),
        default: () => [],
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
    console.log('relevantTables',relevantTables)
    return { ...state, relevantTables };
  }

  private async getTablesNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const queryResults = []
    for(const table of state.relevantTables)  {
        const questionData = {
            datasetQuery: {
                database: this.database,
                type: "query",
                query: {
                    "source-table": table.id
                }
            }
        };        
        const tableResult = await getDatasetQuery(this.companyName, state.sessionToken, questionData);
        if (tableResult && tableResult.data) {
            const colNames = tableResult.data.cols
                .map((col: any) => col.name)
                .map((colName: string) => colName.charAt(0).toUpperCase() + colName.slice(1));
            queryResults.push({ name: table.name, rows: tableResult.data.rows, columns: colNames });
        }
    }
    console.log('queryResults',queryResults)
    return { ...state, queryResult: queryResults };
  }

  private async plannerNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const tables = state.queryResult.map((table: any) => ({
        tableName: table.name,
        rows: table.rows.slice(0,10),
        columns: table.columns
      }));
  
      const formattedTables = JSON.stringify(tables)
    
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePlanTool]);

    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        
        You are provided with one or more tables. Each table contains its name, rows of data, and column names.
        
        For each table, you will receive:
        tableName: The name of the table.
        rows: The actual data in the table.
        columns: The name of each column in the table.
        
        table data: ${formattedTables}
  
        Create a detailed step-by-step plan to extract insights based on the task above. Your plan should be an array of steps, where each step includes:
  
        1. Step Name: A brief, descriptive name for the step.
        2. Description: A detailed description of what this step should accomplish.
        3. Columns: Specify which columns to use from each table. Ensure that the selected columns actually exist in the given table.
        4. Transformations: Detail any data transformations required for this step (e.g., aggregations, filtering, or calculations).
        5. Visualization: If applicable, suggest an appropriate visualization (e.g., bar chart, scatter plot, line chart) for this step.
        6. Expected Insight: Describe the insight or information you expect to gain from this step.
  
        IMPORTANT: This plan will be used to generate Python code for each step. Ensure that each step is clear, concise, and can be translated into a single Python script.
        IMPORTANT: Choose columns that actually exist in the table and avoid columns that do not exist.
        IMPORTANT: The plan should be returned as a JSON array of step objects.
  
        Here's an example of how the plan should be structured:
  
        [
          {
            "stepName": "Identify Underperforming Products",
            "description": "Calculate the sales performance of each product over the past month and compare it to the previous month to identify underperforming products.",
            "columns": ["ProductId", "ItemName", "TotalSold", "CreatedAt"],
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
            "columns": ["ProductId", "ItemName", "TotalSold", "CreatedAt", "DayOfWeek"],
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
        console.error('Error sending plan to user:', error);
      }


    return {...state, plan: plan}
  }

  private async generatePythonCodeNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    // const queryAttempts =  (state.queryAttempts || 0) + 1;
    // if (queryAttempts > 3) {
    //   Logger.log("Unable to generate a suitable python code after 3 attempts.")
    //   return {
    //     ...state,
    //     queryAttempts, 
    //     finalResult: "Unable to generate a suitable python code after 3 attempts. Here is the feedback message: "
    //   }
    // }
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePythonCodeTool]);

    const tables = state.queryResult.map((table: any) => ({
      tableName: table.name,
      columns: table.columns,
      rows: table.rows.slice(0,10)
    }));

    console.log('state.plan',state.plan)

    const formattedTables = JSON.stringify(tables)
    const pythonCodes: string[] = [];
    const pythonCodeIds: number[] = [];
    for (const step of state.plan)  {
      const message = await model.invoke([
        new HumanMessage(`
          **IMPORTANT: Do not include the table data in the code; as I already declared a variable named table_data.**
          **IMPORTANT: Handle indentation properly to avoid errors. Ensure consistent use of spaces or tabs for indentation throughout the code.**
          **IMPORTANT: If there is a plan provided, follow the plan to generate the code. Do not generate code without following the plan.**
  
          Task: "${state.task}"
          You are provided with one or more tables. Each table contains its name, rows of data, and column names. The goal is to focus on how to process this data logically, not on the data loading aspect.
  
          For each table, you will receive:
  
          tableName: The name of the table.
          columns: The name of each column in the table.
          rows: The actual data in the table.
  
          table_data: "${formattedTables}"
  
          ${step ? `Here is the plan for the code: ${step} Follow this plan to generate the code.` : ''}
  
          - Your task is to generate Python code that extracts insights from this table data using pandas for data manipulation and matplotlib or seaborn for visualizations.
          - Ensure that the code is complete and executable in a Jupyter notebook without any additional imports or data.
          - The human user will only see the print statements and visualizations, so make sure all outputs are clear and well-explained.
          - Include comments in the code to indicate the purpose of each step and ensure that any functions you define are executed.
          - Aim to provide a thorough solution that fully addresses the task, even if it requires loops or extensive code.
          - Verify that table_data is a list of dictionaries before creating the DataFrame. If table_data is not in the expected format, convert it to the required format using the appropriate pandas function (e.g., df = pd.DataFrame(table_data)).
          **Reminder: Handle indentation properly to avoid errors. Ensure consistent use of spaces or tabs for indentation throughout the code.**
          **Reminder: Do not include the table data in the code; as I already declared a variable named table_data.**
        `)
      ]);

      console.log('message.lc_kwargs.tool_calls[0].args',message.lc_kwargs.tool_calls[0].args)
  
      const { pythonCode, plan } = message.lc_kwargs.tool_calls[0].args;
      console.log('pythonCode',pythonCode)
      if (pythonCode) {
        pythonCodes.push(pythonCode);
        pythonCodeIds.push(state.codeId);
        state.codeId++;
      }
    }
  
    console.log('pythonCodeIds',pythonCodeIds)

    return { ...state, pythonCode: pythonCodes, pythonCodeIds: pythonCodeIds };
  }

  private async executeCodeNode(state: InsightExtractorState): Promise<InsightExtractorState> {

    const tables = state.queryResult.map((table: any) => ({
        tableName: table.name,
        columns: table.columns,
        rows: table.rows
      }));

    const formattedTables = JSON.stringify(tables)

    const insightDataArr: any[] = [];
    const execArray: any[] = [];

    console.log('length of pythonCode',state.pythonCode.length)
    
    for (let i = 0; i < state.pythonCode.length; i++)  {
      const pythonCode = state.pythonCode[i];
      const codeId = state.pythonCodeIds[i];
      
      const resultArr = []
    const encodedPythonCode = `
import json
  
print("Loading data")
  
table_data = json.loads('''${formattedTables}''')
  
print("Data loaded")
  
${pythonCode}
`;
    
      const codeInterpreter = await getCodeInterpreterInstance();
    
      const exec = await runCodeInterpret(codeInterpreter, encodedPythonCode, this.functions);
      
      if (!exec) {
        throw new Error("Failed to execute Python code");
      }
    
      Logger.log('[Code Interpreter Logs]', exec.logs);
      console.log('state.queryAttempts from Execute Node',state.queryAttempts)
      if(state.queryAttempts < 2) {
        if(exec.error){
          Logger.error(exec.error);
          // throw new Error(exec.error.value);
          Logger.warn(`Code Interpreter Error ${pythonCode}`, exec.error.value);
          resultArr.push(exec.error);
          state.errorCodes.push(pythonCode)
          state.errorCodeIds.push(codeId)
          state.errorMessages.push(`ErrorName:${exec.error.name} ErrorValue:${exec.error.value} ErrorTraceback:${exec.error.traceback}`)
        }
      }
    
      let insightData: any = {
        logs: exec.logs,
        results: []
      };
    
      if (exec.results.length === 0) {
        Logger.log('No results from Code Interpreter');
      } else {
        exec.results.forEach((result, index) => {
          Logger.log(`[Code Interpreter Result ${index + 1}]`, result.text);
          resultArr.push(result)
          if (result.png) {
            const pngData = Buffer.from(result.png, 'base64');
            const filename = `chart_${Date.now()}_${index}.png`;
            const filePath = path.join(process.cwd(), 'outputs', filename);
    
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, pngData);
    
            Logger.log(`Saved chart to ${filePath}`);
    
            insightData.results.push({
              type: 'image',
              description: result.text,
              filename: filename,
              base64: result.png
            });
          } else {
            insightData.results.push({
              type: 'text',
              content: result.text
            });
          }
        });
        execArray.push(exec);
      }

      const getPythonCodeWithResult = [
        {
            function_name: 'getPythonCodeWithResult',
            arguments: {
                pythonCode: encodedPythonCode,
                result: resultArr,
                codeId: codeId
            }
        }
      ]
      this.functions[0]('tool', getPythonCodeWithResult);
    
      const insight = JSON.stringify(insightData); // we should pass the stdout, to the frontend parsed, and store it as the final result with the long strings cutted
      insightDataArr.push(insightData);
      await codeInterpreter.close();

    }

    // console.log('insightDataArr',insightDataArr)
    // console.log('execArray',execArray)


    const output = execArray[0]?.logs?.stdout?.join(' ') ?? execArray[0]?.logs ?? '';
    
    return { ...state, insightsData:insightDataArr, finalResult: output };
  }

  private async ErrorCodeNode(state: InsightExtractorState): Promise<InsightExtractorState>  {
    
    const queryAttempts =  (state.queryAttempts || 0) + 1;
    // if (queryAttempts > 2) {
    //   Logger.log("Unable to Fix the error after 2 attempts.")
    //   return {
    //     ...state,
    //     queryAttempts
    //   }
    // }
    console.log('state.queryAttempts from Error Node',state.queryAttempts)

    const model = createStructuredResponseAgent(getFasterModel(), [GenerateFixedCodeTool]);
    state.pythonCode = [];
    const newPythonCode = [];
    const newPythonCodeIds = [];
    for(let i = 0; i < state.errorCodes.length; i++)  {
      const errorCode = state.errorCodes[i];
      // console.log('errorCode', errorCode)
      const errorMessage = state.errorMessages[i]
      // console.log('errorMessage', errorMessage)
      const errorCodeId = state.errorCodeIds[i]
      
      const message = await model.invoke([
        new HumanMessage(`
          You generated the following error code:
          ${errorCode}
          
          Here is the error message:
          ${errorMessage}

          Please analyze the error, identify the issue, and then generate the complete, corrected code. 
          IMPORTANT: generate the entire code, not only the fix.
          
          `)
        ]);
        
        // const errorMessage = message.content;
        const { fixedCode } = message.lc_kwargs.tool_calls[0].args;
        // console.log('fixedCode', fixedCode)
        newPythonCode.push(fixedCode);
        newPythonCodeIds.push(errorCodeId)
        // Logger.log('Error Message', errorMessage)
      }

      console.log('newPythonCodeIds',newPythonCodeIds)

      state.errorCodes = [];
      state.errorMessages = [];
      state.errorCodeIds = [];

      

    return { ...state, pythonCode: newPythonCode, pythonCodeIds: newPythonCodeIds, queryAttempts: queryAttempts };
  }

  private async extractActionableInsightsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const model = createStructuredResponseAgent(getFasterModel(), []);
  
    const tables = state.queryResult.map((table: any) => ({
      tableName: table.name,
      columns: table.columns,
      rows: table.rows.slice(0,10)
    }));

  const formattedTables = JSON.stringify(tables)

  console.log('state.finalResult',state.finalResult)

    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        You are provided with one or more tables. Each table contains its name, rows of data, and column names.
  
        For each table, you will receive:

        tableName: The name of the table.
        columns: The name of each column in the table.
        rows: The actual data in the table.

        table_data: "${formattedTables}"

        And the following result:
        ${state.finalResult}
  
        Please actionable insights that can be presented alongside the result.
        Focus on the most important and practical takeaways that can lead to concrete actions or decisions.
        Present each insight as a bullet point, starting with a clear, concise statement followed by a brief explanation if necessary.
      `)
    ]);
  
    const actionableInsights = message.content; // TODO: send this to frontend
    Logger.log('Actionable insights', actionableInsights)

    const updatedInsightsData = state.insightsData.map((insight, index) => {
      if (index === 0) {
        return {
          ...insight,
          insightExplanation: actionableInsights,
        };
      }
      return insight;
    });
    
    const getInsightsImages = [
      {
        function_name: 'getInsightsImages',
        arguments: {
          insights: updatedInsightsData,
        },
      },
    ];
    
    this.functions[0]('tool', getInsightsImages);
    
    return { ...state, finalResult: actionableInsights.toString() };
  }

  getGraph(): CompiledStateGraph<InsightExtractorState> {
    const graphBuilder = new StateGraph<InsightExtractorState>({ channels: this.channels });
  
    graphBuilder
      .addNode("fetch_schema", this.fetchSchemaNode.bind(this))
      .addNode('select_tables', this.identifyRelevantTablesNode.bind(this))
      .addNode('get_tables', this.getTablesNode.bind(this))
      .addNode("plan_execution", this.plannerNode.bind(this))
      .addNode("generate_python_code", this.generatePythonCodeNode.bind(this))
      .addNode("execute_code", this.executeCodeNode.bind(this))
      .addNode("error_code", this.ErrorCodeNode.bind(this))
      .addNode("extract_actionable_insights", this.extractActionableInsightsNode.bind(this))
      .addEdge(START, "fetch_schema")
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
      .addEdge("generate_python_code", "execute_code")
      .addConditionalEdges('execute_code', (state) => {
        if (state.stopExecution) {
          return END;
        } else if (state.errorCodes.length > 0 && state.queryAttempts < 2) {
          return 'error_code';
        } else {
          return 'extract_actionable_insights';
        }
      })
      .addEdge("error_code", "execute_code")
      .addEdge("extract_actionable_insights", END);
  
    return graphBuilder.compile();
  }
}
