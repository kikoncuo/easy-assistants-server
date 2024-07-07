import { WebSocketServer } from 'ws';
import { GraphApplication } from './services/GraphApplication';
import { WebSocketService } from './services/WebSocketService';
import { SemanticLayerGraph } from './subgraphs/createSemanticLayer';
import fs from 'fs';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';
import Logger from './utils/Logger';
dotenv.config();

const {
  OPENAI_API_KEY,
  TAVILY_API_KEY,
  LANGCHAIN_API_KEY,
  LANGCHAIN_PROJECT,
  LANGCHAIN_TRACING_V2,
  GROQ_API_KEY,
  ANTHROPIC_API_KEY,
  MEMORY_STORAGE_SUPABASE_URL,
  MEMORY_STORAGE_SUPABASE_KEY
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
  throw new Error(
    'All API keys (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY) are missing. Please provide at least one API key.',
  );
} else if (missingApiKeys.length > 0) {
  Logger.warn(`Warning: The following API keys are missing: ${missingApiKeys.join(', ')}`);
}

if (!LANGCHAIN_API_KEY) {
  Logger.warn('Warning: LANGCHAIN_API_KEY is not set. Activity logging will be disabled.');
}

if (!MEMORY_STORAGE_SUPABASE_URL) {
  Logger.warn('Warning: MEMORY_STORAGE_SUPABASE_URL is not set. Activity logging will be disabled.');
}

if (!MEMORY_STORAGE_SUPABASE_KEY) {
  Logger.warn('Warning: MEMORY_STORAGE_SUPABASE_KEY is not set. Activity logging will be disabled.');
}

const isProd = process.env.BUN_ENV === 'production';

if (!isProd) {
  Logger.log('Development mode');
}

const port = isProd ? 443 : 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

if (isProd) {
  const options = {
    cert: fs.readFileSync('/etc/letsencrypt/live/chat.omniloy.com/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/chat.omniloy.com/privkey.pem'),
  };

  const httpsServer = https.createServer(options, (req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Upgrade required');
  });

  httpsServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  });

  httpsServer.listen(port, () => {
    Logger.log(`WSS server is running on port ${port}`);
  });
} else {
  server.listen(port, () => {
    Logger.log(`WS server is running on port ${port}`);
  });
}

wss.on('connection', ws => {
  Logger.log('Client connected');

  let graphApp = new GraphApplication( // TODO: Delete this once we've migrated to always calling configure afrter connection
    (type: string, message: string) => WebSocketService.outputHandler(type, message, ws),
    (type: string, functions: Array<{ function_name: string; arguments: any }>) =>
      WebSocketService.queryUser(type, functions, ws),
    ["","", ""],
  );

  if (graphApp.error) {
    Logger.error(graphApp);
  }

  ws.on('message', async (message: string) => {
    const data = JSON.parse(message);
    if (data.type === 'query') {
      Logger.log('Processing task:', data.task);
      await graphApp.processTask(data.task, data.thread_id, ws);
    }
    else if (data.type === 'configure') {
      Logger.log('Configuring new graph application');
      graphApp = new GraphApplication(
        (type: string, message: string) => WebSocketService.outputHandler(type, message, ws),
        (type: string, functions: Array<{ function_name: string; arguments: any }>) =>
          WebSocketService.queryUser(type, functions, ws),
        data.configData,
      );
    }
    else if (data.type === 'createSemanticLayer') {
      Logger.log('Creating semantic layer');
      //onst semanticLayerGraph = new SemanticLayerGraph(data.prefixes, data.pgConnectionString, // TODO: Pass in the functions here to interact with the user, not sure how to do this
      //const result = await semanticLayerGraph.getGraph().invoke({task:"Create a semantic layer for the company's data"});
      //WebSocketService.outputHandler('semanticLayer', result.finalResult, ws);
    }


  });

  ws.on('close', () => {
    Logger.log('Client disconnected');
  });
});
