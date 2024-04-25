import { GraphManager } from './GraphManager';
import {
  getStrongestModel,
  getFasterModel,
  groqChatMixtral,
  groqChatSmallLlama,
  anthropicSonnet,
  anthropicOpus,
  createAgent,
  anthropicHaiku,
  groqChatLlama,
  createPlanner,
  createSolver,
} from '../models/Models';
import {
  calculatorTool,
  emailTool,
  rewardTool,
  filterTool,
  eventTool,
  tableTool,
  chartTool,
  infoCardTool,
  pageHtmlTool,
  sqlQuery,
  segmentTool,
  organizeItemTool,
  getTables,
  getSegmentDetails
} from '../models/Tools';
import Logger from '../utils/Logger';

export class GraphApplication {
  private graphManager: GraphManager;

  constructor(outputHandler: Function, agentFunction: Function) {
    const haiku = anthropicHaiku();
    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const llama70bGroq = groqChatLlama();
    const llama8bGroq = groqChatSmallLlama();
    const sonnet = anthropicSonnet();
    const opus = anthropicOpus();

    const agents = {
      calculate: {
        agent: createAgent(fasterModel, [calculatorTool]),
        agentPrompt:
          'You are an LLM specialized on math operations with access to a calculator tool, you are asked to perform a math operation at the time',
      },
      organize: {
        agent: createAgent(fasterModel, [organizeItemTool]),
        agentPrompt:
          'You are an LLM specialized on rearranging items in an array as requested by the user',
      },
      getTables: {
        agent: createAgent(strongestModel, [getTables], true),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. 
        You are provided with a list of table definitions and your task is to determine the most suitable tables based on the context of the user's needs. 
        Assess the table names to identify the most relevant and useful tables that align with the user's objectives for data analysis, reporting.
        Always use the tool you have access to.`,
      },
      getSegmentDetails: {
        agent: createAgent(strongestModel, [getSegmentDetails], true),
        agentPrompt: `You are an LLM with advanced capabilities in analyzing database schemas. 
        Based on that list of table columns that the user will provide and his request, generate the SQL query to adquire the user's needs`,
      },
    };

    this.graphManager = new GraphManager(createPlanner(strongestModel), agents, createSolver(llama8bGroq), outputHandler, agentFunction);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    Logger.log('Final result:', finalResult);
  }
}
