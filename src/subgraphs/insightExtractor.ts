import { AbstractGraph, BaseState } from './baseGraph';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { getExampleRelatedCards, getRelevantCards, getRelevantTables } from './nodes/cardLogic';
import { authenticate, getCard, getDatasetAsCSV, getDatasetQuery } from '../utils/MetabaseAPI';
import { HumanMessage } from '@langchain/core/messages';
import { createStructuredResponseAgent, getStrongestModel } from '../models/Models';
import Logger from '../utils/Logger';
import { GeneratePlanTool } from '../models/Tools';
import { createThread, createMessage, streamRun, uploadTables } from '../utils/AssistantsOpenAI';
import OpenAI from 'openai';
import { ActivityManager } from '../utils/ActivityManager';
import { createNodeResponse } from '../utils/NodeResponseUtils';
import { ConfigurationManager } from '../utils/ConfigurationManager';
import { PostgresSaver } from '../checkpoint/postgres';
import { similaritySearch } from '../utils/EmbeddingUtils';

type MessageType = 'Image' | 'Text' | 'Code';

interface InsightExtractorState extends BaseState {
  task: string;
  queryResult: any[];
  fieldDetails: Record<number, any>; 
  isPossible: string;
  relevantCards: any[];
  cardIds: number[];
  plan: any[];
  codeInterpreterThreadId: string; 
  runId: string; 
  continued: boolean;
  result: string;
  feedbackMessage: string;
  finalResult: string; 
}

export class InsightExtractorGraph extends AbstractGraph<InsightExtractorState> {
  private database: number;
  private companyName: string;
  private functions: Function[];
  private schema: any[];
  private sessionToken: string;

  constructor(databaseId: number, functions: Function[], companyName: string, schema: any[]) {
    const graphState: StateGraphArgs<InsightExtractorState>['channels'] = {
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
      relevantCards: {
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
      feedbackMessage: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      cardIds: {
        value: (x: number[], y?: number[]) => (y ? y : x),
        default: () => [],
      },
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

  private async selectCardsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    let ids = [];
    let cards = [];
    const filter = { databaseID: this.database };
    const similaritySearchWithScoreResults = await similaritySearch(this.companyName, state.task, 3, filter);
    for (const [doc, score] of similaritySearchWithScoreResults) {
      Logger.log(
        `* [SIM=${score.toFixed(3)}] ${doc.pageContent} [${JSON.stringify(
          doc.metadata
        )}]`
      );
      cards.push({ id: doc.metadata.id, name: doc.pageContent, status: 'current' });
      ids.push(doc.metadata.id);
    }
    const { relevantCards } = await getRelevantCards(state.task, cards, state.relevantCards, state.continued, state.result);
    Logger.log('relevantCards', relevantCards)
    ids = ids.filter(id => relevantCards.some(card => card.id === id));
    if(ids.length < 1) {
      this.functions[0]('info', createNodeResponse('error', { message: "No cards found for the task" }));
      return { ...state, relevantCards: [] };
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: "Relevant cards related to the task have been identified", data: { relevantCardIds: ids } }));
      const tablesNeeded = 'no';
       Logger.log('changeNeeded', tablesNeeded)
      return { ...state, isPossible: tablesNeeded, cardIds: ids };
    }
  }

  private async getCardsNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const ids = state.cardIds;
    if (ids && ids.length > 0) {
      for(const id of ids) {
        const card = await getCard(this.companyName, this.sessionToken, id);
        if (card) {
          state.queryResult.push({ name: card.name, result: card.result_metadata, dataset_query: card.dataset_query });
          state.relevantCards.push({ name: card.name, result: card.result_metadata, dataset_query: card.dataset_query, status: 'current' });
        }
      }
      this.functions[0]('info', createNodeResponse('data', { message: "Example cards related to the task have been identified", data: { exampleCardIds: ids } }));
    } else {
      this.functions[0]('info', createNodeResponse('data', { message: "Using fallback example cards for task"}));
    }
    return { ...state };
  }

  private async plannerNode(state: InsightExtractorState): Promise<InsightExtractorState> {
    const cards = state.queryResult.map((card: any) => ({
        cardName: card.name,
        result: card.result,
        dataset_query: card.dataset_query
      }));
  
    const formattedCards = JSON.stringify(cards)
    
    const model = createStructuredResponseAgent(getStrongestModel(), [GeneratePlanTool]);

    const message = await model.invoke([
      new HumanMessage(`
        Given the following task: "${state.task}"
        
        You are provided with several cards. Each card contains:
        
        1. cardName: The name of the card
        2. result: An array of objects describing the fields in the result, including:
          - fieldName: The name of the column (e.g., "itemName", "sum").
          - description: A brief description of the column (e.g., "Name of the item", "Sum of TotalWasted").
          - base_type: The data type of the column (e.g., "type/Text", "type/Float").
          - fingerprint: Statistical information about the field's values
        3. dataset_query: The query used to generate the card's data
        
        Card data: ${formattedCards}
  
        Create a detailed step-by-step plan to extract insights based on the task above. Your plan should be an array of steps, where each step includes:

        1. Step Name: A brief, descriptive name for the step.
        2. Description: A detailed description of what this step should accomplish.
        3. Transformations: Detail any data transformations required for this step (e.g., aggregations, filtering, or calculations).
        4. Visualization: If applicable, suggest an appropriate visualization (e.g., bar chart, scatter plot, line chart) for this step.
        5. Expected Insight: Describe the insight or information you expect to gain from this step.
  
        IMPORTANT: This plan will be used to generate Python code for each step. Ensure that each step is clear, concise, and can be translated into a single Python script.
        IMPORTANT: Choose columns that actually exist in the card and avoid columns that do not exist.
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
    let codeInterpreterThreadId = state.codeInterpreterThreadId;
    const openai = new OpenAI();
    const activityManager = new ActivityManager(openai);

    const cardsToQuery = state.relevantCards.filter(card => card.status === 'current');

    if (!codeInterpreterThreadId) { // If there is no codeInterpreterThreadId create it and expect a plan and files
      
      codeInterpreterThreadId = await createThread();

      const csvs = await this.getDatasetAsCSV(cardsToQuery, this.sessionToken, this.database, this.companyName);

      const attachments = await uploadTables(csvs);
    
      await createMessage(codeInterpreterThreadId, JSON.stringify(state.plan), attachments);
    
    } else { // If there is a codeInterpreterThreadId, we are continuing a plan we will just send the new task
      
      if(state.continued && cardsToQuery.length > 0) {
        
        const csvs = await this.getDatasetAsCSV(cardsToQuery, this.sessionToken, this.database, this.companyName);
        
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
        activityManager.updateActivity();
        Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`)
        if(imageData) {
          this.sendImageAndTextToFrontend(imageData, "Image", status, runId, codeInterpreterThreadId);
        }
        this.sendImageAndTextToFrontend(tool.input, "Code", status, runId, codeInterpreterThreadId);
      },
      (content, status, runId) => {
        activityManager.updateActivity();
        this.sendImageAndTextToFrontend(content, "Text", status, runId);
        Logger.log(`\nTEXT DONE > ${JSON.stringify(content, null, 2)}`);
        if(status === 'completed') {
          state.result = content.value;
        }
      }
    );

    // await pollRun(
    //   codeInterpreterThreadId, 
    //   assistantId, 
    //   (tool) => Logger.log(`\nTOOL CALL DONE > ${JSON.stringify(tool, null, 2)}\n\n`),
    //   (content, snapshot) => saveOpenAIImage(content.image_file.file_id), // TODO: create a private function to send the image to the frontend
    //   (content, snapshot) => Logger.log(`\nTEXT DONE > ${JSON.stringify(content, null, 2)}`)
    // );

    activityManager.stopMonitoring();
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

  private async getDatasetAsCSV(relevantCards:any[], sessionToken: string, databaseID:number, companyName:string): Promise<any> {
    const csvs: { [cardName: string]: string } = {};
    for(const card of relevantCards) {
      let retry = true;
      let retryCount = 0;
      let csv;
      const query = card.dataset_query
      const payload = {
        query: JSON.stringify(query)
      };
      while (retry) {
        try {
            csv = await getDatasetAsCSV(companyName, payload, sessionToken);
            if (csv && csv.via && csv.via.length > 0 && csv.via[0].status === "failed") {
              retryCount++;  
              Logger.log(`CSV for card ${card.name} failed, retry attempt ${retryCount}`);
              this.functions[0]('info', createNodeResponse('error', { message: `Card ${card.name} couldn't be retrieved for network issues, retry attempt ${retryCount}...` }));
            } else {
              retry = false; // Exit retry loop if no failure
              this.functions[0]('info', createNodeResponse('data', { message: `Successfully retrieved card ${card.name}`, data: {csv: card.name} }));
            }
          } catch (error) {
            console.error(`Error fetching CSV for card ${card.name}:`, error);
          retry = false; // Exit retry loop in case of an error
        }
      }
        csvs[card.name] = csv;
    }
    return csvs;
  }

  getGraph(): CompiledStateGraph<InsightExtractorState> {
    const graphBuilder = new StateGraph<InsightExtractorState>({ channels: this.channels });
    const clientConfig = ConfigurationManager.getConfig(this.companyName);

    graphBuilder
      .addNode("select_cards", this.selectCardsNode.bind(this))
      .addNode("get_cards", this.getCardsNode.bind(this))
      .addNode("plan_execution", this.plannerNode.bind(this))
      .addNode("generate_python_code", this.codeInterpreterNode.bind(this))
      .addEdge(START, "select_cards")
      .addConditionalEdges('select_cards', (state) => { // Now if there is a threadId from openai, we will go there directly
        if (state.codeInterpreterThreadId !== '' && state.isPossible === 'yes') {
          return 'generate_python_code';
        } 
        if (state.cardIds.length >= 1 && state.isPossible === 'no') {
          return 'get_cards';
        } else {
            return END;
        }
      })
      .addConditionalEdges('get_cards', (state) => {
        if (state.continued === true) {
          return 'generate_python_code';
        } else {
          return 'plan_execution';
        }
      })
      .addEdge('plan_execution', 'generate_python_code') 
      .addEdge("generate_python_code", END)
    
      
      // const poolConfig = {
      //   host: clientConfig.PG_HOST,
      //   port: Number(clientConfig.PG_PORT),
      //   user: clientConfig.PG_USER,
      //   password: clientConfig.PG_PASSWORD,
      //   database: clientConfig.PG_DATABASE,
      // };
      
      // const postgresSaver = new PostgresSaver(poolConfig);

    return graphBuilder.compile();
  }

  getApp(): any {
    return this.getGraph();
  }
}