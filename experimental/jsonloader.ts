function parseJsonString(jsonString: string): any {
  // Regular expression to match JSON-like strings within double quotes
  const jsonRegex = /"(\[.*?\])"/g;

  // Replace JSON-like strings with placeholders
  const modifiedString = jsonString.replace(jsonRegex, (match, jsonLike) => {
    return `"${encodeURIComponent(jsonLike)}"`;
  });

  // Parse the modified string as JSON
  const parsedObject = JSON.parse(modifiedString);

  // Recursively replace placeholders with parsed JSON objects
  function replacePlaceholders(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(replacePlaceholders);
    } else if (typeof obj === 'object' && obj !== null) {
      return Object.entries(obj).reduce((acc, [key, value]) => {
        acc[key] = replacePlaceholders(value);
        return acc;
      }, {} as any);
    } else if (typeof obj === 'string') {
      const decodedString = decodeURIComponent(obj);
      if (decodedString.startsWith('[') && decodedString.endsWith(']')) {
        return JSON.parse(decodedString.replace(/\\/g, ''));
      }
      return obj;
    } else {
      return obj;
    }
  }

  // Replace placeholders in the parsed object
  const result = replacePlaceholders(parsedObject);

  return result;
}

// Example usage
const jsonString = `{
  "steps": [
    {
      "stepId": "#E1",
      "description": "Sort the array alphabetically",
      "toolName": "organize",
      "toolParameters": ["[{\"title\":\"Total Sales\",\"data\":990496},{\"title\":\"Avg. Items purchased\",\"data\":6,\"percentage\":15},{\"title\":\"Avg. Spent\",\"data\":349,\"percentage\":11},{\"title\":\"Identified Sales\",\"data\":\"57 %\",\"percentage\":13},{\"title\":\"No purchases\",\"data\":10000,\"percentage\":5},{\"title\":\"Total Transactions\",\"data\":104318}]"],
      "arrangement": "alphabetically"
    }
  ]
}`;

const parsedJson = parseJsonString(jsonString);
console.log(parsedJson);