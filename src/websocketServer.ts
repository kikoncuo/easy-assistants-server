import { WebSocketServer } from "ws";
import { GraphApplication, customOutputHandler, queryUser } from "./graphApplication";
import fs from "fs";
import https from "https";
import http from "http";
import dotenv from 'dotenv';
dotenv.config();

const {
  OPENAI_API_KEY,
  TAVILY_API_KEY,
  LANGCHAIN_API_KEY,
  LANGCHAIN_PROJECT,
  LANGCHAIN_TRACING_V2,
  GROQ_API_KEY,
  ANTHROPIC_API_KEY,
} = process.env;

const missingApiKeys: string[] = [];

if (!OPENAI_API_KEY) {
  missingApiKeys.push('OPENAI_API_KEY');
}

if (!GROQ_API_KEY) {
  missingApiKeys.push('GROQ_API_KEY');
}

if (!ANTHROPIC_API_KEY) {
  missingApiKeys.push('ANTHROPIC_API_KEY');
}

if (missingApiKeys.length === 3) {
  throw new Error('All API keys (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY) are missing. Please provide at least one API key.');
} else if (missingApiKeys.length > 0) {
  console.warn(`Warning: The following API keys are missing: ${missingApiKeys.join(', ')}`);
}

if (!LANGCHAIN_API_KEY) {
  console.warn('Warning: LANGCHAIN_API_KEY is not set. Activity logging will be disabled.');
}
const isProd = process.env.BUN_ENV === "production";

if (!isProd) {
  console.log("Development mode");
}

const port = isProd ? 443 : 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

if (isProd) {
  const options = {
    cert: fs.readFileSync("/etc/letsencrypt/live/chat.omniloy.com/fullchain.pem"),
    key: fs.readFileSync("/etc/letsencrypt/live/chat.omniloy.com/privkey.pem"),
  };

  const httpsServer = https.createServer(options, (req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("Upgrade required");
  });

  httpsServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  httpsServer.listen(port, () => {
    console.log(`WSS server is running on port ${port}`);
  });
} else {
  server.listen(port, () => {
    console.log(`WS server is running on port ${port}`);
  });
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  const graphApp = new GraphApplication(
    (type: string, message: string) => customOutputHandler(type, message, ws),
    (type: string, functions: Array<{ function_name: string; arguments: any }>) => queryUser(type, functions, ws)
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