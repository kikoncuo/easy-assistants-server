import WebSocket from 'ws';
import Logger from '../utils/Logger';

export class WebSocketService {
  static outputHandler(type: string, message: string, ws: WebSocket): void {
    Logger.log(`${type}: ${message}`);
    ws.send(JSON.stringify({ type, message }));
  }

  static async queryUser(
    type: string,
    functions: Array<{ function_name: string; arguments: any }>,
    ws: WebSocket,
  ): Promise<{ [key: string]: string }> {
    Logger.log(`Querying user for ${type} with function:`, functions);
    ws.send(JSON.stringify({ type, functions }));

    return new Promise<{ [key: string]: string }>(resolve => {
      const responses: { [key: string]: string } = {};
      ws.on('message', (message: string) => {
        const data = JSON.parse(message);
        if (data.type === 'toolResponse') {
          let toolResponse = data.response;

          if (typeof toolResponse === 'string') {
            try {
              toolResponse = JSON.parse(toolResponse);
            } catch (error) {
              Logger.error("Error parsing toolResponse: ", error);
              return; 
            }
          }
          if (Array.isArray(toolResponse)) {
            toolResponse.forEach((response: { function_name: string; response: string }) => {
              Logger.log(`Received response for ${response.function_name}: ${response.response}`);
              responses[response.function_name] = response.response.trim();
            });
          } else if (toolResponse && toolResponse.function_name) {
            Logger.log(`Received response for ${toolResponse.function_name}: ${toolResponse.response}`);
            responses[toolResponse.function_name] = toolResponse.response.trim();
          } else {
            Logger.error("Unexpected toolResponse format: ", toolResponse);
          }
          if (Object.keys(responses).length === functions.length) {
            resolve(responses);
          }
        }
      });
    });
  }
}
