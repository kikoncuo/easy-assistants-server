/** @format */

// client.ts
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");

ws.on("open", () => {
  console.log("Connected to server");

  // Send a query to the server
  // const query = `create a new table with this data [["id","created_at","name","created_by","last_edited"],["1","2024-02-22 22:45:22","User action 1","Deactivated User Smith","2024-01-10"]]`;
  const query = `create a  new campaign for all male users over 30 years old that bought jackets. Reward them with 20% discount in all purchases. The campaign should be triggered on the 7th of april. The campaign should include an email explaining the discount.`;
  ws.send(JSON.stringify({ type: "query", task: query }));
});

ws.on("message", (message: string) => {
  const data = JSON.parse(message);

  if (data.type === "tool") {
    console.log("🚀 ~ ws.on ~ data:", data);
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
        let response = prompt(`Enter your response for ${function_name}:`);

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
