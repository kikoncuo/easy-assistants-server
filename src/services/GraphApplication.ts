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
} from '../models/Tools';
import Logger from '../utils/Logger'; 

export class GraphApplication {
  private graphManager: GraphManager;

  constructor(outputHandler: Function, clientAgentFunction: Function) {
    const haiku = anthropicHaiku();
    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const llama70bGroq = groqChatLlama();
    const llama8bGroq = groqChatSmallLlama();
    const sonnet = anthropicSonnet();
    const opus = anthropicOpus();

    const agents = {
      calculate: {
        agent: createAgent(fasterModel, [calculatorTool], clientAgentFunction),
        agentPrompt:
          'You are an LLM specialized on math operations with access to a calculator tool, you are asked to perform a math operation at the time',
      },
      organize: {
        agent: createAgent(fasterModel, [organizeItemTool], clientAgentFunction),
        agentPrompt:
          'You are an LLM specialized on rearranging items in an array as requested by the user',
      },
    };

    this.graphManager = new GraphManager(createPlanner(llama8bGroq), agents, createSolver(llama8bGroq), outputHandler);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    Logger.log('Final result:', finalResult);
  }
}
