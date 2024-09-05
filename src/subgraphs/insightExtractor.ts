import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { fetchSchema, executeMetabaseQuery, getFieldDetails, evaluateCards, identifyRelevantSources, createMetabaseCard } from './nodes/cardLogic';
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
  fieldDetails: Record<number, any>; 
  isPossible: string;
  relevantCards: any[]; 
  newCardDescription: string;
  insightsData: any[]; 
  queryAttempts: number;
  stopExecution: boolean;
  feedbackMessage: string;
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

  private async evaluateFieldsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const { fieldDetails, isPossible } = await getFieldDetails(state.task, state.sessionToken, state.schema, this.companyName);
    return { ...state, fieldDetails };
  }

  private async identifyRelevantSourcesNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const relevantCards = await identifyRelevantSources(state.task, state.sessionToken, this.database, state.schema, this.companyName);

    if (relevantCards.length > 0) {
      return {
        ...state,
        relevantCards: relevantCards,
      };
    } else {
      Logger.log("No relevant cards found to create the insights")
      return {
        ...state,
        relevantCards: []
      };
    }
  }

  private async evaluateCardsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const { areCardsEnough, newCardDescription } = await evaluateCards(
      state.task, 
      state.sessionToken, 
      state.relevantCards, 
      this.database, 
      this.companyName
    );
  
    if (areCardsEnough) {
      return {
        ...state,
        isPossible: 'yes'
      };
    } else {
      return {
        ...state,
        isPossible: 'no',
        newCardDescription: newCardDescription
      };
    }
  }

  private async createCardNode(state: InsightExtractorState): Promise<InsightExtractorState> {

    try {
    const result = await createMetabaseCard(state.task, state.sessionToken, state.schema, state.fieldDetails, this.database, this.companyName);  
        Logger.log('Result', result)
      if ('cardId' in result && typeof result.cardId === 'number') {
        return { ...state, cardId:result.cardId };
      } else {
        throw new Error ('error' in result ? result.error : 'unknown error');
      }
    } catch (error: any) {
      throw new Error(`Failed to create card: ${error.message}`);
    }
  }

  private async executeQueryNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    if (state.relevantCards.length > 1) {
        const queryResults = [];
        for (const card of state.relevantCards) {
          try {
            const result = await executeMetabaseQuery(state.sessionToken, card.id, null, this.companyName);
            if ('error' in result) {
              Logger.warn(`Failed to execute query for card ${card.id}: ${result.error}`);
              // queryResults.push({ cardId: card.id, error: result.error });
            } else {
              Logger.log(`Query result for card ${card.id}:`, result.queryResult);
              queryResults.push(...result.queryResult);
            }
          } catch (error) {
            Logger.error(`Error executing query for card ${card.id}:`, error);
            // queryResults.push({ cardId: card.id, error: error });
          }
        }
        return { ...state, queryResult: queryResults };
      } else {
    const result = await executeMetabaseQuery(state.sessionToken, state.cardId, null, this.companyName);
    
    if ('error' in result) {
      throw new Error(`Failed to execute query: ${result.error}`);
    }

    Logger.log('\n\n\nQuery result:', result.queryResult);

    return { ...state, queryResult: result.queryResult };
    }
  }

  private async generatePythonCodeNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const queryAttempts =  (state.queryAttempts || 0) + 1;
    if (queryAttempts > 3) {
      Logger.log("Unable to generate a suitable python code after 3 attempts.")
      return {
        ...state,
        queryAttempts, 
        finalResult: "Unable to generate a suitable python code after 3 attempts. Here is the feedback message: "
      }
    }
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePythonCodeTool]);
    Logger.log('state.queryResult', state.queryResult)
    const itemCount = Array.isArray(state.queryResult) ? state.queryResult.length : 1;
    console.log(`Number of items in original queryResult: ${itemCount}`);
    Logger.log('state.feedbackMessage', state.feedbackMessage)

    //     Given the following task: "${state.task}"
    //     And the following query result (truncated to 10,000 characters): ${JSON.stringify(state.queryResult).slice(0, 10000)}
        
    //     The original query result contains ${itemCount} item(s).
    
    //     Generate Python code to extract relevant insights based on the task and the query result.
    //     Use pandas for data manipulation and matplotlib or seaborn for any visualizations.
    //     Ensure the code is complete and can be executed without additional imports or data.
    //     Your code will be run automatically in a jupyter notebook.
    //     Produce all required code to fully answer the users task, Don't be afraid of doing loops or writing too much code.
    //     The human will read only the prints and can't see the code, make sure that all prints are explained and the data in the graph is printed as a JSON as well.
    //     You don't need to include the query result, we've loaded it like query_result = json.loads(query_result) in an earlier step.
    //     Note that the query_result provided in the code will be the full result, not the truncated version.
    //     Also add comments to the code to keep track of the code execution.
    //     If you create a function, make sure to call it, don't comment it out.
    //     Important: Do not create query_result or import json, or query_result = json.loads(query_result), that's already done earlier in the code
    // ------------------------------------------------------------------------
    const message = await model.invoke([
      new HumanMessage(`
        **IMPORTANT: Do not include the query result in the code; as I already declared a variable named query_result.**
        **IMPORTANT: Handle indentation properly to avoid errors. Ensure consistent use of spaces or tabs for indentation throughout the code.**

        Task: "${state.task}"
        You are provided with a query result that has been truncated to 10,000 characters for this task: : ${JSON.stringify(state.queryResult).slice(0, 10000)}
        The full query result is available during execution, so focus on the logic and not the data loading.

        ${state.feedbackMessage ? `
          Error Feedback
          An error occurred when executing the previously generated code. Here is the previous code:
          ${state.pythonCode}
          
          
          Please address this error:
          
          ${state.feedbackMessage}
          
          When generating the new code:
          
          Carefully analyze the error message.
          Identify the root cause of the error.
          Implement a solution that directly addresses this issue.
          If the error is unclear or seems unrelated to your code, consider adding robust error handling and logging to help diagnose the problem.
          Explain your changes and reasoning in comments within the code.
          ` : ""}

        - The original query result contains ${itemCount} item(s).
        - Your task is to generate Python code that extracts insights from this query result using pandas for data manipulation and matplotlib or seaborn for visualizations.
        - If a column name has special characters, **remove** or **replace** those characters to create a cleaned and consistent column name that can be used in the code. For example, remove arrows or other special symbols and replace them with spaces.
        - If the column names are inconsistent, use flexible column name detection.
        - Ensure all columns used in groupby operations contain scalar values (strings, numbers, etc.).
        - Ensure that the code is complete and executable in a Jupyter notebook without any additional imports or data.
        - The human user will only see the print statements and visualizations, so make sure all outputs are clear and well-explained.
        - Include comments in the code to indicate the purpose of each step and ensure that any functions you define are executed.
        - Aim to provide a thorough solution that fully addresses the task, even if it requires loops or extensive code.
        - Verify that query_result is a list of dictionaries before creating the DataFrame. If query_result is not in the expected format, convert it to the required format using the appropriate pandas function (e.g., df = pd.DataFrame(query_result)).
        **Reminder: Handle indentation properly to avoid errors. Ensure consistent use of spaces or tabs for indentation throughout the code.**
        **Reminder: Do not include the query result in the code; as I already declared a variable named query_result.**
      `)
    ]);

    const { pythonCode, plan } = message.lc_kwargs.tool_calls[0].args;
    console.log('plan------------------------------------------',plan)
    return { ...state, pythonCode, codeExplanation: plan };
  }

  private async executeCodeNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    // Logger.log('state.queryResult', state.queryResult)
    const queryResultJson = JSON.stringify(state.queryResult);
    // Logger.log('queryResultJson', queryResultJson)
    const getPythonCode = [
        {
            function_name: 'getPythonCode',
            arguments: {
                pythonCode: state.pythonCode
            }
        }
    ]
    this.functions[0]('tool', getPythonCode);
    const encodedPythonCode = `
import json

print("Loading data")

query_result = json.loads('''${queryResultJson}''')

print("Data loaded")

${state.pythonCode}
`;
  
    const codeInterpreter = await getCodeInterpreterInstance();
  
    const exec = await runCodeInterpret(codeInterpreter, encodedPythonCode, this.functions);
    
    if (!exec) {
      throw new Error("Failed to execute Python code");
    }
  
    Logger.log('[Code Interpreter Logs]', exec.logs);
    if(exec.error){
      Logger.error(exec.error);
      // throw new Error(exec.error.value);
      if(state.queryAttempts > 3){
        Logger.log("Unable to generate a suitable query after 3 attempts.")
        return {
          ...state,
          queryAttempts: state.queryAttempts + 1,
          finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + exec.error.value,
          stopExecution: true
        }
      } else {
        return {
          ...state,
          feedbackMessage: JSON.stringify(exec.error),
          queryAttempts: state.queryAttempts + 1,
        }
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
    }
  
    const insight = JSON.stringify(insightData); // we should pass the stdout, to the frontend parsed, and store it as the final result with the long strings cutted

    await codeInterpreter.close();
    return { ...state, insightsData:insightData.results, finalResult: exec.logs.stdout.join(' ') };
  }

  private async extractActionableInsightsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const model = createStructuredResponseAgent(getFasterModel(), []);
  
    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        On the following data (truncated to 10,000 characters): ${JSON.stringify(state.queryResult).slice(0, 10000)}

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
      .addNode('identify_sources', this.identifyRelevantSourcesNode.bind(this))
      .addNode('evaluate_fields', this.evaluateFieldsNode.bind(this))
    //   .addNode('evaluate_cards', this.evaluateCardsNode.bind(this))
      .addNode("create_card", this.createCardNode.bind(this))
      .addNode("execute_query", this.executeQueryNode.bind(this))
      .addNode("generate_python_code", this.generatePythonCodeNode.bind(this))
      .addNode("execute_code", this.executeCodeNode.bind(this))
      .addNode("extract_actionable_insights", this.extractActionableInsightsNode.bind(this))
      .addEdge(START, "fetch_schema")
      .addEdge('fetch_schema', 'identify_sources')
      .addConditionalEdges('identify_sources', (state) => {
        if (state.relevantCards.length >= 1) {
          return 'execute_query';
        } else {
          return 'evaluate_fields';
        }
      })
      .addEdge('evaluate_fields', 'create_card')
      .addEdge("create_card", "execute_query")
      .addEdge("execute_query", "generate_python_code")
      .addConditionalEdges('execute_code', (state) => {
        if (state.queryAttempts > 3 || state.stopExecution) {
          return END;
        } else if (state.insightsData.length > 0) {
          return 'extract_actionable_insights';
        }
        else {
          return 'generate_python_code';
        }
      })
      .addEdge("generate_python_code", "execute_code")
      .addEdge("extract_actionable_insights", END);
  
    return graphBuilder.compile();
  }
}
