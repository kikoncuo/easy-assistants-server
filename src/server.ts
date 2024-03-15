/** @format */

// server.ts
import { WebSocketServer } from "ws";
import { GraphManager } from "./LangraphReWoo";
import {
  getStrongestModel,
  getFasterModel,
  groqChatMixtral,
  anthropicSonnet,
  createAgent,
} from "./models";
import {
  calculatorTool,
  emailTool,
  rewardTool,
  filterTool,
  eventTool,
  tableTool,
  tableData,
  chartTool,
} from "./tools";

class GraphApplication {
  private graphManager: GraphManager;
  private outputHandler: (type: string, message: string, ws: WebSocket) => void;

  constructor(
    outputHandler: (type: string, message: string) => void = console.log,
    agentFunction: Function
  ) {
    this.outputHandler = outputHandler;

    const strongestModel = getStrongestModel();
    const fasterModel = getFasterModel();
    const groqModel = groqChatMixtral();
    const anthropicModel = anthropicSonnet();

    const agents = {
      calculate: {
        agent: createAgent(fasterModel, [calculatorTool]),
        agentPrompt:
          "You are an LLM specialized on math operations with access to a calculator tool.",
      },
      createCampaing: {
        agent: createAgent(fasterModel, [
          emailTool,
          rewardTool,
          filterTool,
          eventTool,
        ]),
        agentPrompt:
          "You are an LLM specialized on creating campaings, in order to create a campaing you will need to call all your tools once to get all the components of a campaign",
      },
      createTable: {
        agent: createAgent(strongestModel, [tableTool, tableData]),
        agentPrompt:
          "You are an LLM specialized in the entire process of transforming JSON data into a fully functional PostgreSQL table. This includes generating a CREATE TABLE statement that reflects the data's structure and inserting the data if  given. You have access to tools that not only generate the table schema but also transform the JSON array into an array of objects, each representing a row ready for bulk insertion. This ensures a seamless transition from data analysis to database implementation, making it ideal for platforms like Supabase. Use both tools (createData, insertData), always insert the data after creating the table if data is provided.",
      },
      createChart: {
        agent: createAgent(fasterModel, [chartTool]),
        agentPrompt:
          "You are an LLM specialized in generating chart data from JSON arrays. Based on the input data, you determine the most suitable chart type (bar, line, doughnut) or adhere to a specific type if provided. You have access to a tool that facilitates this process, ensuring optimal integration into JavaScript charting components.",
      },
    };

    this.graphManager = new GraphManager(
      fasterModel,
      agents,
      strongestModel,
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

const customOutputHandler = (type: string, message: string, ws: WebSocket) => {
  console.log(`${type}: ${message}`);
  ws.send(JSON.stringify({ type, message }));
};

const queryUser = async (
  type: string,
  functions: Array<{ function_name: string; arguments: any }>,
  ws: WebSocket
) => {
  //console.log(`Querying user for ${type} with functions:`, functions);

  ws.send(JSON.stringify({ type: type, functions }));

  return new Promise<{ [key: string]: string }>((resolve) => {
    const responses: { [key: string]: string } = {};

    ws.on("message", (message: string) => {
      const data = JSON.parse(message);
      if (data.type === "toolResponse") {
        responses[data.function_name] = data.response;

        if (Object.keys(responses).length === functions.length) {
          resolve(responses);
        }
      }
    });
  });
};

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  console.log("Client connected");

  const graphApp = new GraphApplication(
    (type: string, message: string) => customOutputHandler(type, message, ws),
    (
      type: string,
      functions: Array<{ function_name: string; arguments: any }>
    ) => queryUser(type, functions, ws)
  );

  ws.on("message", async (message: string) => {
    const data = JSON.parse(message);
    if (data.type === "query") {
      console.log("Processing task:", data.task);
      await graphApp.processTask(data.task, ws);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

console.log("WebSocket server is running on port 8080");
