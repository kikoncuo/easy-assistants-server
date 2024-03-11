// client-simulator.ts

// This script simulates multiple clients connecting to the server and responding to queries automatically, it's used to measure client performance and server load handling vs the python implementation
import WebSocket from 'ws';

const numClients = 5; // Number of clients to simulate

function createClient() {
  const ws = new WebSocket('ws://localhost:8080');

  ws.on('open', () => {
    console.log('Connected to server');

    // Send a query to the server
    const query = "Create a campaign for men over 50 years old, with a discount of 20% in all products. Include an email explaining the discount.";
    ws.send(JSON.stringify({ type: 'query', task: query }));
  });

  ws.on('message', (message: string) => {
    const data = JSON.parse(message);

    if (data.type === 'tool') {
      // Server is querying the user for input
      const { function_name, args } = data;
      console.log(`Server is querying for ${function_name} with args:`, args);

      if (function_name === 'calculate' && typeof args.a === 'number' && typeof args.b === 'number' && typeof args.operator === 'string') {
        // Automatically respond to the calculate query
        let result;
        switch (args.operator) {
          case 'add':
            result = args.a + args.b;
            break;
          case 'subtract':
            result = args.a - args.b;
            break;
          case 'multiply':
            result = args.a * args.b;
            break;
          case 'divide':
            result = args.a / args.b;
            break;
          case 'power':
            result = Math.pow(args.a, args.b);
            break;
          case 'root':
            result = Math.pow(args.a, 1 / args.b);
            break;
          default:
            console.log('Invalid operator:', args.operator);
            return;
        }
        console.log('Calculated result:', result);
        // Send the calculated result back to the server
        ws.send(JSON.stringify({ type: 'toolResponse', response: result.toString() }));
      } else {
        console.log('Unsupported query:', data);
      }
    } else if (data.type === 'result') {
      // Server has sent a result
      console.log('Result:', data.message);
    } else {
      // Handle other message types if needed
      console.warn('Received message:', data);
      console.warn("This simulator script was supossed to know how to answer the petition automatically, but it doesn't know how to process this.")
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from server');
  });
}

// Create multiple client connections
for (let i = 0; i < numClients; i++) {
  createClient();
}