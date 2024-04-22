// client.ts
import WebSocket from 'ws';

let ws: WebSocket | null = null;

function connectToServer() {
  ws = new WebSocket('ws://localhost:8080');

  ws.on('open', () => {
    console.log('Connected to server');
    promptUserInput();
  });

  ws.on('message', (message: string) => {
    const data = JSON.parse(message);
    if (data.type === 'tool') { // TODO: Low priority, but right now, this can only do one tool response at a time
      // Server is querying the user for input
      const { functions } = data;
      // Process each function and send the responses back to the server
      const responses = functions.map(({ function_name, arguments: args }: { function_name: string, arguments: { template_name: string, subject: string, message: string } }) => {
        console.log(`Processing function: ${function_name} with args:`, args);

        let response = prompt(`Enter your response for ${function_name}:`);
        
        return { function_name, response };
      });
      // Send the responses back to the server
      ws?.send(JSON.stringify({ type: 'toolResponse', response: JSON.stringify(responses) }));
    } else if (data.type === 'result') {
      // Server has sent a result
      console.log('Result:', data.message);
      promptUserInput();
    } else if (data.type === 'plan') {
      // Server has sent a result
      console.log('Here is the plan:', data.message);
    } else {
      // Handle other message types if needed
      console.log('Received message:', data);
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from server');
    // Retry connection after 5 seconds
    setTimeout(connectToServer, 5000);
  });
}

function promptUserInput() {
  const query = prompt('Enter your message:');
  if (query && ws) {
    ws.send(JSON.stringify({ type: 'query', task: query }));
  }
}

connectToServer();