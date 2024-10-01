// client.ts
import WebSocket from 'ws';
import Logger from '../src/utils/Logger';
import dotenv from 'dotenv';
import { schema } from '../experimental/schema';
dotenv.config();


let ws: WebSocket | null = null;
const thread_id = Math.floor(Math.random() * 1000);
const appType = 'test';

function connectToServer() {
  ws = new WebSocket('ws://localhost:8090');
  
  ws.on('open', () => {
    Logger.log('Connected to server');
    ws?.send(JSON.stringify({ type: 'configure', configData: [9, "blank_street"], appType: appType, schema: schema }));
    promptUserInput();

   /*ws?.send(JSON.stringify({ 
      type: 'editSemanticLayer', 
      task: "Create a measure for Total Lifetime Value (TLV) of customers",
      company_name: "omni_test"
    }));*/

    // ws?.send(JSON.stringify({ 
    //   type: 'createSemanticLayer', 
    //   prefixes: "csv",
    //   pgConnectionString: process.env.TEST_POSTGRES_MANUAL
    // }));
  });

  ws.on('message', (message: string) => {
    const data = JSON.parse(message);
    if (data.type === 'tool') {
      // Server is querying the user for input
      const { functions } = data;
      // Process each function and send the responses back to the server
      Logger.log('Processing tool responses');
      Logger.log('Functions:', functions);
      const result = prompt(`Enter your response for function:`);
      Logger.log(`Response: ${result}`);
      const responses = { function_name: functions[0].name, response: result };
      // Send the responses back to the server
      ws?.send(JSON.stringify({ type: 'toolResponse', response: JSON.stringify(responses), appType: appType }));
    } else if (data.type === 'result') {
      // Server has sent a result
      Logger.log('Result:', data.message);
      Logger.timeEnd('planTimer');
      promptUserInput();
    } else if (data.type === 'directResponse') {
      Logger.log('Result:', data.message);
      Logger.timeEnd('planTimer');
      promptUserInput();
    } else if (data.type === 'plan') {
      // Server has sent a result
      Logger.log('Here is the plan:\n', data.message);
    } else {
      // Handle other message types if needed
      Logger.log('Received message:', data);
      let response = prompt('Enter your response (may not be required):');
      ws?.send(JSON.stringify({ type: 'toolResponse', response: JSON.stringify(response), appType: appType }));
    }
  });

  ws.on('close', () => {
    Logger.log('Disconnected from server');
    // Retry connection after 5 seconds
    setTimeout(connectToServer, 5000);
  });
}

function promptUserInput() {
  let query = prompt('Enter your message:');
  if (!query) {
    // If the query is empty, set it to the result of 3*6 divided by 2
    query = "what's 3*6 divided by 2"
    Logger.log(`No input provided. what's 3*6 divided by 2`);
  }
  if (query == "db") {
    // If the query is empty, set it to the result of 3*6 divided by 2
    query = "give me my top 5 customers who bought the most products"
    Logger.log(`Using DB test. give me my top 5 customers who bought the most products`);
  } 

  if (ws) {
    Logger.time('planTimer'); // Start the timer
    ws.send(JSON.stringify({ type: 'query', task: query, thread_id:  thread_id, appType: appType }));
  }
}

function calculateResult(args: { a: number | string; b: number | string; operator: string }): number {
  let a = typeof args.a === 'string' ? parseFloat(args.a) : args.a;
  let b = typeof args.b === 'string' ? parseFloat(args.b) : args.b;

  switch (args.operator) {
    case 'add':
    case '+':
      return a + b;
    case 'subtract':
    case '-':
      return a - b;
    case 'multiply':
    case '*':
      return a * b;
    case 'divide':
    case '/':
      return a / b;
    case 'power':
    case '^':
      return Math.pow(a, b);
    case 'root':
      return Math.pow(a, 1 / b);
    default:
      throw new Error(`Unknown operator: ${args.operator}`);
  }
}

connectToServer();
