import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, executeMetabaseQuery } from './nodes/cardLogic';
import { createCard } from '../utils/MetabaseAPI';
import { HumanMessage } from '@langchain/core/messages';
import { createStructuredResponseAgent, getFasterModel, getStrongestModel } from '../models/Models';
import Logger from '../utils/Logger';
import { getCodeInterpreterInstance, runCodeInterpret } from '../utils/codeInterpreter';
import { GeneratePythonCodeTool } from '../models/Tools';
import fs from 'fs'; // Just for testing, delete this and path later, and add the code to send the image to the frontend
import path from 'path';

interface InsightExtractorState extends BaseState {
  task: string;
  schema: any[];
  sessionToken: string;
  cardId: number;
  queryResult: any;
  pythonCode: string;
  codeExplanation: string;
  insight: string;
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
      cardId: {
        value: (x: number, y?: number) => (y !== undefined ? y : x),
        default: () => 0,
      },
      queryResult: {
        value: (x: any, y?: any) => (y ? y : x),
        default: () => null,
      },
      pythonCode: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
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

  private async createCardNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const cardData = {
      name: "Data for Insight Extraction",
      description: `Card created for task: ${state.task}`,
      display: "table",
      dataset_query: {
        database: this.database,
        type: "query",
        query: {
          "source-table": state.schema[0].id,
          limit: 1000
        }
      },
      visualization_settings: {}
    };

    try {
      const cardId = await createCard(this.companyName, state.sessionToken, cardData);
      
      if (typeof cardId === 'number') {
        return { ...state, cardId };
      } else {
        throw new Error(cardId.error);
      }
    } catch (error: any) {
      throw new Error(`Failed to create card: ${error.message}`);
    }
  }

  private async executeQueryNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const result = await executeMetabaseQuery(state.sessionToken, state.cardId, null, this.companyName);
    
    if ('error' in result) {
      throw new Error(`Failed to execute query: ${result.error}`);
    }

    Logger.log('\n\n\nQuery result:', result.queryResult);

    return { ...state, queryResult: result.queryResult };
  }

  private async generatePythonCodeNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePythonCodeTool]);

    const itemCount = Array.isArray(state.queryResult) ? state.queryResult.length : 1;
    console.log(`Number of items in original queryResult: ${itemCount}`);
    
    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        And the following query result (truncated to 10,000 characters): ${JSON.stringify(state.queryResult).slice(0, 10000)}
        
        The original query result contains ${itemCount} item(s).

        Here is some business context: Each row represents a measure from a sensor identified as linea
        you have to perform your analysis in a per linea basis and compare them across the different lineas
    
        Generate Python code to extract relevant insights based on the task and the query result.
        Use pandas for data manipulation and matplotlib or seaborn for any visualizations.
        Ensure the code is complete and can be executed without additional imports or data.
        Your code will be run automatically in a jupyter notebook.
        The human will read only the prints and can't see the code, make sure that all prints are explained and the data in the graph is printed as a JSON as well.
        You don't need to include the query result, we've loaded it like query_result = json.loads(query_result) in an earlier step.
        Do not create query_result or import json, or query_result = json.loads(query_result), that's already done earlier in the code
        Note that the query_result provided in the code will be the full result, not the truncated version.
        If you create a function, make sure to call it, don't comment it out.
        
      `)
    ]);

    const { pythonCode, explanation } = message.lc_kwargs.tool_calls[0].args;
    return { ...state, pythonCode, codeExplanation: explanation };
  }

  private async executeCodeNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const queryResultJson = JSON.stringify(state.queryResult);
    const encodedPythonCode = `
import json

print("Loading data")

query_result = json.loads('''${queryResultJson}''')

print("Data loaded")

${state.pythonCode}
`;
  
    const codeInterpreter = await getCodeInterpreterInstance();
  
    const exec = await runCodeInterpret(codeInterpreter, encodedPythonCode);
    
    if (!exec) {
      throw new Error("Failed to execute Python code");
    }
  
    Logger.log('[Code Interpreter Logs]', exec.logs);
    if(exec.error){
      Logger.error(exec.error);
      throw new Error(exec.error.value);
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
  
        if (result.png) {
          const pngData = Buffer.from(result.png, 'base64');
          const filename = `chart_${Date.now()}.png`;
          const filePath = path.join(process.cwd(), 'outputs', filename);
  
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, pngData);
  
          Logger.log(`Saved chart to ${filePath}`);
  
          insightData.results.push({
            type: 'image',
            description: result.text,
            filename: filename
          });
        } else {
          insightData.results.push({
            type: 'text',
            content: result.text
          });
        }
      });
    }
  
    const insight = JSON.stringify(insightData); // we should pass the stdout, to the frontend parsed, and store it as the final result with the long strings cutted
  
    await codeInterpreter.close();
    return { ...state, finalResult: exec.logs.stdout.join(' ') };
  }

  private async extractActionableInsightsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const model = createStructuredResponseAgent(getFasterModel(), []);
  
    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        On the following data (truncated to 10,000 characters): ${JSON.stringify(state.queryResult).slice(0, 10000)}

        And the following result:
        ${state.finalResult}
  
        Please extract 3-5 actionable insights that can be presented alongside the result.
        Focus on the most important and practical takeaways that can lead to concrete actions or decisions.
        Present each insight as a bullet point, starting with a clear, concise statement followed by a brief explanation if necessary.
      `)
    ]);
  
    const actionableInsights = message.content; // TODO: send this to frontend
    return { ...state, finalResult: actionableInsights.toString() };
  }

  getGraph(): CompiledStateGraph<InsightExtractorState> {
    const graphBuilder = new StateGraph<InsightExtractorState>({ channels: this.channels });
  
    graphBuilder
      .addNode("fetch_schema", this.fetchSchemaNode.bind(this))
      .addNode("create_card", this.createCardNode.bind(this))
      .addNode("execute_query", this.executeQueryNode.bind(this))
      .addNode("generate_python_code", this.generatePythonCodeNode.bind(this))
      .addNode("execute_code", this.executeCodeNode.bind(this))
      .addNode("extract_actionable_insights", this.extractActionableInsightsNode.bind(this))
      .addEdge(START, "fetch_schema")
      .addEdge("fetch_schema", "create_card")
      .addEdge("create_card", "execute_query")
      .addEdge("execute_query", "generate_python_code")
      .addEdge("generate_python_code", "execute_code")
      .addEdge("execute_code", "extract_actionable_insights")
      .addEdge("extract_actionable_insights", END);
  
    return graphBuilder.compile();
  }
}
