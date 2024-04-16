/** @format */

// client.ts
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");

ws.on("open", () => {
  console.log("Connected to server");

  // Send a query to the server
  const query =
    "Create a segment for all users who didn't bought shoes last year based on this table names:transactions,members,shipping_methods,related_charts,products,product_attributes,product_attribute_terms,tax_classes,segments,forms,tax_rates,related_users,lists,orders,deals,contacts,product_shipping_classes,system_status_tools,campaigns,product_variations,coupons,customers,shipping_zones,profiles,product_reviews,shipping_zone_locations,order_notes,shipping_zone_methods,payment_gateways,refunds,countries,product_tags,product_categories,category";
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
