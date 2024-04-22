import { GraphManager } from "./LangraphReWoo";
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
} from "./models";
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
} from "./tools";

export class GraphApplication {
  private graphManager: GraphManager;
  private outputHandler: (type: string, message: string, ws: WebSocket) => void;

  constructor(
    outputHandler: (type: string, message: string) => void = console.log,
    agentFunction: Function
  ) {
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
          "You are an LLM specialized on math operations with access to a calculator tool, you are asked to perform a math operation at the time",
      },
    };

    this.graphManager = new GraphManager(
      createPlanner(llama8bGroq),
      agents,
      llama8bGroq,
      outputHandler,
      agentFunction
    );
  }

  async processTask(task: string, ws: WebSocket) {
    const finalResult = await this.graphManager.getApp().invoke({ task });
    if (finalResult) {
      this.outputHandler("result", finalResult.result, ws);
    }
  }
}

// This function is called when the agent answers a message, Currently it just sends it to the user via the WS
export const customOutputHandler = (type: string, message: string, ws: WebSocket) => {
  console.log(`${type}: ${message}`);
  ws.send(JSON.stringify({ type, message }));
};

// This function is called when the agent needs to query the user to get the answer of a tool, Currently it just sends it to the user via the WS and expects a response, it can ask for multiple tools at once
export const queryUser = async (
  type: string,
  functions: Array<{ function_name: string; arguments: any }>,
  ws: WebSocket
) => {
  console.log(`Querying user for ${type} with function:`, functions);
  ws.send(JSON.stringify({ type, functions }));
  return new Promise<{ [key: string]: string }>((resolve) => {
    const responses: { [key: string]: string } = {};
    ws.on("message", (message: string) => {
      const data = JSON.parse(message);
      if (data.type === "toolResponse") {
        const toolResponses = JSON.parse(data.response); // TODO: Check if we can send JSONs directly
        toolResponses.forEach(
          (toolResponse: { function_name: string; response: string }) => {
            console.log(`Received response for ${toolResponse.function_name}: ${toolResponse.response}`);
            responses[toolResponse.function_name] =
              toolResponse.response.trim();
          }
        );
        if (Object.keys(responses).length === functions.length) {
          resolve(responses);
        }
      }
    });
  });
};