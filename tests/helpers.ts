
  export const testTables = `Transactions Table
  TransactionID: A unique identifier for each transaction (Primary Key).
  UserID: The identifier for the user who made the transaction, linking to the Users table (Foreign Key).
  ProductID: The identifier for the product involved in the transaction, linking to the Products table (Foreign Key).
  Quantity: The number of products purchased in the transaction.
  Price: The price of the product at the time of the transaction.
  Date: The date and time when the transaction took place.
  PaymentMethod: The method of payment used (e.g., credit card, PayPal, etc.).

Users Table
  UserID: A unique identifier for each user (Primary Key).
  FirstName: The first name of the user.
  LastName: The last name of the user.
  Email: The email address of the user.
  SignUpDate: The date when the user created their account.
  LastLogin: The date and time of the user's last login.

Products Table
  ProductID: A unique identifier for each product (Primary Key).
  ProductName: The name of the product.
  Description: A brief description of the product.
  Price: The current price of the product.
  StockQuantity: The number of units of the product currently in stock.
  Category: The category or type of the product.
Example: if the user asks for an ordered list of revenue based on user id, try to generate a query like this: select "USER_ID", "NAME", "EMAIL", sum(cast("REVENUE" as numeric)) as total_revenue from "snowflake_OFFER_CHECKOUT" group by "USER_ID", "REVENUE" order by total_revenue desc;`

import WebSocket from 'ws';
import Logger from '../src/utils/Logger';

let ws: WebSocket | null = null;

export function connectToServer(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket('ws://localhost:8080');

    ws.on('open', () => {
      Logger.log('Connected to server');
      resolve(ws as WebSocket);
    });

    ws.on('error', (err) => {
      Logger.log('Connection error:', err);
      reject(err);
    });

    ws.on('close', () => {
      Logger.log('Disconnected from server');
    });
  });
}

export function sendConfigMessage(ws: WebSocket, configData: any): void {
  ws.send(JSON.stringify({ type: 'configure', configData }));
}

export function sendMessage(ws: WebSocket, message: string, functionMap: { [key: string]: Function }): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const responses: any[] = [];

    ws.send(message);

    const messageHandler = (message: string) => {
      const data = JSON.parse(message);
      responses.push(data);

      if (data.type === 'plan') {
        Logger.log(`Got plan: \n${data.message}`);
      }

      if (data.type === 'directResponse') {
        Logger.log(`Direct response: \n${data.message}`);
        ws.off('message', messageHandler);  
        resolve(responses);
      }

      if (data.type === 'tool') {
        const { functions } = data;
        const toolResponses = functions.map(
          ({ function_name, arguments: args }: { function_name: string; arguments: any }) => {
            Logger.log(`Processing function: ${function_name} with args:`, args);

            if (functionMap[function_name]) {
              const result = functionMap[function_name](args);
              Logger.log(`Result of ${function_name} was provided`);
              return { function_name, response: result.toString() };
            } else {
              const errorMessage = `Error: Function ${function_name} not found. Ensure the function is defined in functionMap and exists in helpers.ts.`;
              Logger.log(errorMessage);
              throw new Error(errorMessage);
            }
          }
        );
        ws.send(JSON.stringify({ type: 'toolResponse', response: JSON.stringify(toolResponses) }));
      }

      if (data.type === 'result') {
        Logger.log(`Result: ${data.message}`);
        ws.off('message', messageHandler);  
        resolve(responses);
      }
    };

    ws.on('message', messageHandler);

    ws.on('error', (err) => {
      ws.off('message', messageHandler);  // Remove the event listener on error
      reject(err);
    });
  });
}

export function calculateResult(args: { a: number | string; b: number | string; operator: string }): number {
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

export function getData(): string {
  const userData: { UserID: number; TotalLifetimeValue: number }[] = [
    { UserID: 1, TotalLifetimeValue: 1250 },
    { UserID: 2, TotalLifetimeValue: 940 },
    { UserID: 3, TotalLifetimeValue: 875 },
    { UserID: 4, TotalLifetimeValue: 630 },
    { UserID: 5, TotalLifetimeValue: 560 }
  ];
  return JSON.stringify(userData, null, 2);
}

export function createChart(): string {
  return "Chart created successfully"
}

export function askHuman(): string {
  return "Doughnut chart with the total revenue per user"
}

export function insertRecommendations(tableString:string, recommendations:any) {
  // Create a map of table names to their recommendations
  const recommendationMap = recommendations.reduce((map:any, item:any) => {
    map[item.name] = item.recommendation;
    return map;
  }, {});

  // Split the input string into individual table strings
  const tables = tableString.split(/\nTable: /).filter(Boolean);

  // Process each table
  const updatedTables = tables.map(table => {
    // Extract the table name from the first line
    const tableName = table.split('\n')[0].trim();
    
    // Get recommendations for this table
    const tableRecommendations = recommendationMap[tableName] || [];
    
    if (tableRecommendations.length > 0) {
      // If there are recommendations, add them to the table string
      const recommendationString = '\nRecommendations:\n' + tableRecommendations.map((rec:any) => ` - ${rec}`).join('\n');
      return `Table: ${table}${recommendationString}`;
    } else {
      // If no recommendations, return the original table string
      return `Table: ${table}`;
    }
  });

  // Join the updated tables back into a single string
  return updatedTables.join('\n\n');
}

export function extractCubeNames(content:any) {
  const cubeRegex = /cube\s*\(`([^`]+)`/g;
  const cubeNames = [];
  let match;

  while ((match = cubeRegex.exec(content)) !== null) {
      cubeNames.push(match[1]);
  }

  return cubeNames;
}

export function separateCubes(input:string) {
  Logger.log('inputsssssssss',input)
  const cubeDefinitions = input.split(/cube\(/).slice(1);
  Logger.log('cubeDefinitions',cubeDefinitions)
  const cubes = cubeDefinitions.map(cubeDef => 'cube(' + cubeDef.trim());
  Logger.log('cubes',cubes)

  return cubes;
}