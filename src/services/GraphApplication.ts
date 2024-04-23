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
  private outputHandler: (type: string, message: string, ws: WebSocket) => void;

  constructor(outputHandler: (type: string, message: string) => void = Logger.log, agentFunction: Function) {
    this.outputHandler = outputHandler;
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
    };

    this.graphManager = new GraphManager(createPlanner(llama8bGroq), agents, llama8bGroq, outputHandler, agentFunction);
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    if (finalResult) {
      this.outputHandler('result', finalResult.result, ws);
    }
  }
}
