import { WebSocketServer } from 'ws';
import http from 'http';
import Logger from './utils/Logger';
import { checkEnvironmentVariables } from './utils/EnvCheck';
import { Router } from './router';

checkEnvironmentVariables();

const port = 8090;

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(port, () => {
  Logger.log(`WS server is running on port ${port}`);
});

wss.on('connection', ws => {
  Logger.log('Client connected');

  const router = new Router(ws);

  ws.on('message', async (message: string) => {
    await router.handleMessage(message);
  });

  ws.on('close', () => {
    Logger.log('Client disconnected');
  });
});