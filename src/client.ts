/** @format */

// client.ts
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");

ws.on("open", () => {
  console.log("Connected to server");

  // Send a query to the server
  const query = `create a new table with this data [["id","created_at","name","created_by","last_edited"],["1","2024-02-22 22:45:22","User action 1","Deactivated User Smith","2024-01-10"],["2","2024-02-22 22:45:22","User action 2","Deactivated User User","2024-01-18"],["3","2024-02-22 22:45:22","User action 3","Charly Montes","2024-02-09"],["4","2024-02-22 22:45:22","User action 4","Adam Smith","2024-01-07"],["5","2024-02-22 22:45:22","User action 5","Deactivated User User","2024-02-02"],["6","2024-02-22 22:45:22","User action 6","Adam Montes","2024-01-07"],["7","2024-02-22 22:45:22","User action 7","Charly Smith","2024-01-23"],["8","2024-02-22 22:45:22","User action 8","Deactivated User Smith","2024-02-10"],["9","2024-02-22 22:45:22","User action 9","Deactivated User Montes","2024-01-09"],["10","2024-02-22 22:45:22","User action 10","Deactivated User Smith","2024-01-26"],["11","2024-02-22 22:45:22","User action 11","Deactivated User Montes","2024-01-26"],["12","2024-02-22 22:45:22","User action 12","Charly Smith","2024-01-21"],["13","2024-02-22 22:45:22","User action 13","Charly Smith","2024-01-21"],["14","2024-02-22 22:45:22","User action 14","Adam Smith","2024-01-10"],["15","2024-02-22 22:45:22","User 
    action 15","Charly User","2024-02-04"],["16","2024-02-22 22:45:22","User action 16","Adam Montes","2024-02-10"],["17","2024-02-22 22:45:er action 1","Deactivated User Smith","2024-01-10"],["2","2024-02-22 22:45:22","User action 2","Deactivated User User","2024-01-18"],["3","2024-02-22 22:45:22","User action 322","User action 17","Deactivated User Montes","2024-01-17"],["18","2024-02-22 22:45:22","User action 18","Adam Montes","2024-01-31"],["ction 5","Deactivated User User","2024-02-02"],["6","2024-02-22 22:45:22","User action 6","Adam Montes","2024-01-07"],["7","2024-02-22 22:45:22","User action 7","Charly Smith19","2024-02-22 22:45:22","User action 19","Deactivated User Montes","2024-01-03"],["20","2024-02-22 22:45:22","User action 20","Charly n 9","Deactivated User Montes","2024-01-09"],["10","2024-02-22 22:45:22","User action 10","Deactivated User Smith","2024-01-26"],["11","2024-02-22 22:45:22","User action 11",
    Montes","2024-01-15"],["21","2024-02-22 22:45:22","User action 21","Deactivated User Montes","2024-02-11"],["22","2024-02-22 22:45:22","5:22","User action 13","Charly Smith","2024-01-21"],["14","2024-02-22 22:45:22","User action 14","Adam Smith","2024-01-10"],["15","2024-02-22 22:45:22","User action 15","CharUser action 22","Adam User","2024-01-22"],["23","2024-02-22 22:45:22","User action 23","Deactivated User Montes","2024-02-06"],["24","20 17","Deactivated User Montes","2024-01-17"],["18","2024-02-22 22:45:22","User action 18","Adam Montes","2024-01-31"],["19","2024-02-22 22:45:22","User action 19","Deactivate24-02-22 22:45:22","User action 24","Deactivated User Smith","2024-02-11"],["25","2024-02-22 22:45:22","User action 25","Charly User","2r action 21","Deactivated User Montes","2024-02-11"],["22","2024-02-22 22:45:22","User action 22","Adam User","2024-01-22"],["23","2024-02-22 22:45:22","User action 23","Deac024-01-02"],[""]]`;
  ws.send(JSON.stringify({ type: "query", task: query }));
});

ws.on("message", (message: string) => {
  const data = JSON.parse(message);

  if (data.type === "tool") {
    // Server is querying the user for input
    const { functions } = data;
    console.log("Server is querying for functions:", functions);

    // Process each function and send the responses back to the server
    const responses = functions.map(
      ({
        function_name,
        arguments: args,
      }: {
        function_name: string;
        arguments: { template_name: string; subject: string; message: string };
      }) => {
        console.log(`Processing function: ${function_name} with args:`, args);

        // Replace this with your own input mechanism or automated response logic
        let response;
        if (function_name === "createEmailTemplate") {
          const { template_name, subject, message } = args;
          response = prompt(`Enter your response for ${function_name}:`);
        } else {
          response = prompt(`Enter your response for ${function_name}:`);
        }

        return { function_name, response };
      }
    );

    // Send the responses back to the server
    ws.send(
      JSON.stringify({
        type: "toolResponse",
        response: JSON.stringify(responses),
      })
    );
  } else if (data.type === "result") {
    // Server has sent a result
    console.log("Result:", data.message);
  } else {
    // Handle other message types if needed
    console.log("Received message:", data);
  }
});

ws.on("close", () => {
  console.log("Disconnected from server");
});
