import { expect, test, beforeAll, afterAll } from "bun:test";
import { connectToServer, sendMessage, sendConfigMessage} from "./helpers";
import { calculateResult, getData, createChart, testTables, askHuman } from "./helpers"; //TODO: separate this to a different file

let ws: WebSocket | null = null;

const functionMap = { // This maps points to the tool and the function that will be executed for that tool, we can add real or mock tools for tests
  calculate: calculateResult,
  getData: getData,
  createChart: createChart,
  askHuman: askHuman
  // Add more functions if needed
};

beforeAll(async () => {
  ws = await connectToServer();
});

afterAll(() => {
  ws?.close();
});

test.skip("Conversational test", async () => {
  const query = "Hey! I am Pepe";
  const message = JSON.stringify({ type: 'query', task: query, thread_id: "test" });

  const responses = await sendMessage(ws as WebSocket, message, functionMap);

  // Check the directResponse message
  const directResponse = responses.find(response => response.type === 'directResponse');
  expect(directResponse).toBeDefined();

 
}, 60000);  // Set timeout to 60000 milliseconds. If your test take longer, bring it up with the team, don't change it

test.skip("Ask Human test", async () => {
  const query = "Create a graph to show my top customers";
  const message = JSON.stringify({ type: 'query', task: query, thread_id: "test" });

  const responses = await sendMessage(ws as WebSocket, message, functionMap);

   // Check if there's a response calling the askHuman function
   const askHumanResponse = responses.find(response => {
    return response.type === 'tool' &&
           response.functions.some((func: { function_name: string; }) => func.function_name === 'askHuman');
  });
  expect(askHumanResponse).toBeDefined();

  const getDataResponse = responses.find(response => {
    return response.type === 'tool' &&
           response.functions.some((func: { function_name: string; }) => func.function_name === 'getData');
  });
  expect(getDataResponse).toBeDefined();

  const createChartResponse = responses.find(response => {
    return response.type === 'tool' &&
           response.functions.some((func: { function_name: string; }) => func.function_name === 'createChart');
  });
  expect(createChartResponse).toBeDefined();
 
}, 60000);  // Set timeout to 60000 milliseconds. If your test take longer, bring it up with the team, don't change it

test.skip("WebSocket connection and multiple messages", async () => {
  const query = "what's 3*6 divided by 2";
  const message = JSON.stringify({ type: 'query', task: query, thread_id: "test" });

  const responses = await sendMessage(ws as WebSocket, message, functionMap);

  // Check the plan message
  const planMessage = responses.find(response => response.type === 'plan');
  expect(planMessage).toBeDefined();
  expect(planMessage.message).toContain('#E1');

  // Check the tool messages
  const toolMessages = responses.filter(response => response.type === 'tool');
  expect(toolMessages.length).toBeGreaterThan(0);
  toolMessages.forEach(toolMessage => {
    expect(toolMessage.functions).toBeDefined();
  });

  // Check the result message
  const resultMessage = responses.find(response => response.type === 'result');
  expect(resultMessage).toBeDefined();
  expect(resultMessage.message).toContain('9'); // 3*6/2 = 9
}, 60000);  // Set timeout to 60000 milliseconds. If your test take longer, bring it up with the team, don't change it

test("Memory test", async () => {
  const query = "what's 3*659";
  const message = JSON.stringify({ type: 'query', task: query, thread_id: "test" });

  const responses = await sendMessage(ws as WebSocket, message, functionMap);
  console.log('mesagessssssssssssss',responses)
  const lastResponse = responses[responses.length - 1];

  const query2 = "divide that by 2223.35";
  const message2 = JSON.stringify({ type: 'query', task: query2, thread_id: "test"  });

  const responses2 = await sendMessage(ws as WebSocket, message2, functionMap);

  

  // // Check the plan message
  // const planMessage = responses2.find(response => response.type === 'plan');
  // expect(planMessage).toBeDefined();

  // // Check the tool messages
  // const toolMessages = responses2.filter(response => response.type === 'tool');
  // expect(toolMessages.length).toBeGreaterThan(0);
  // toolMessages.forEach(toolMessage => {
  //   expect(toolMessage.functions).toBeDefined();
  // });

  // Check the result message
  const resultMessage = responses2.find(response => response.type === 'result');
  expect(resultMessage).toBeDefined();
  expect(resultMessage.message).toContain('0.8891987316436909'); // 3*6/2 = 9


}, 60000);  // Set timeout to 60000 milliseconds. If your test take longer, bring it up with the team, don't change it


test.skip("WebSocket configuration and custom query", async () => {
  const configData = ["My company's name is theManualTestCompany", testTables];
  sendConfigMessage(ws as WebSocket, configData);

  const query = "Create a graph to highlight my top 10 customers in terms of their TLV, my tables are Transactions, Users and Products";
  const message = JSON.stringify({ type: 'query', task: query, thread_id: "test" });

  const responses = await sendMessage(ws as WebSocket, message, functionMap);

  // Check the plan message
  const planMessage = responses.find(response => response.type === 'plan');
  expect(planMessage.message).toContain('#E1');
  expect(planMessage.message).toContain('#E2'); // This can be solved with 2 steps
  expect(planMessage.message).not.toContain('#E3'); // Shouldn't be solved with 3

  // Check the tool messages
  const toolMessages = responses.filter(response => response.type === 'tool');
  expect(toolMessages.length).toBeGreaterThan(0);
  toolMessages.forEach(toolMessage => {
    expect(toolMessage.functions).toBeDefined(); // We should have functions called
    if(toolMessage.functions[0].function_name == "getData"){ // As a example, we are gonna check that for getData
      expect(toolMessage.functions[0].arguments.sqlQuery).toContain('UserID'); // Our SQL query contains this values
      expect(toolMessage.functions[0].arguments.sqlQuery).toContain('Price');
      expect(toolMessage.functions[0].arguments.sqlQuery).toContain('Quantity');
    }
  });

  // Check the result message
  const resultMessage = responses.find(response => response.type === 'result');
  expect(resultMessage.message).toContain('successful'); // Because responses can be super wide, we check that conains status successful
}, 60000);  

