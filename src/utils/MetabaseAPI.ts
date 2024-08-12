import axios from 'axios';

const METABASE_URL = 'http://localhost:3000/api';  // Replace with your Metabase instance URL
const METABASE_USERNAME = 'test@omniloy.com';  // Replace with your Metabase username
const METABASE_PASSWORD = 'omniloy2024';  // Replace with your Metabase password

/**
 * Authenticate with Metabase and return a session token.
 */
export async function authenticate(): Promise<string> {
  const response = await axios.post(`${METABASE_URL}/session`, {
    username: METABASE_USERNAME,
    password: METABASE_PASSWORD,
  });

  return response.data.id;  // Returns the session token
}

/**
 * Get the schema for a specific database.
 * @param sessionToken The session token obtained from authentication.
 * @param databaseId The ID of the database for which the schema is being requested.
 */
export async function getSchema(sessionToken: string, databaseId: number): Promise<any[]> {
  const response = await axios.get(`${METABASE_URL}/database/${databaseId}/fields`, {
    headers: {
      'X-Metabase-Session': sessionToken,
    },
  });

  return response.data;  // Returns the schema data
}

/**
 * Create a new card (question) in Metabase.
 * @param sessionToken The session token obtained from authentication.
 * @param schema The schema information obtained from the getSchema function.
 */
export async function createCard(sessionToken: string, cardData: any): Promise<number | { error: string; status: number }> {

  console.log('\n\ncardData', cardData); 

  if (!cardData.visualization_settings) {
    cardData.visualization_settings = {}; // I can't get the AI to generate this, but it picks up the default values if we set it to {}
  }else if (typeof cardData.visualization_settings === 'string') {
    cardData.visualization_settings = JSON.parse(cardData.visualization_settings);
  }

  try {
  const response = await axios.post(`${METABASE_URL}/card`, cardData, {
    headers: {
      'X-Metabase-Session': sessionToken,
      'Content-Type': 'application/json',
    },
  });

  return response.data.id; 
  } catch (error: any) {
    if (error.response) {
      console.log('Error creating card:', error.response.data);
      if (error.response.data["specific-errors"]) {
        return { error: JSON.stringify(error.response.data["specific-errors"], null, 2), status: error.response.status };
      } else if (error.response.data) {
        return { error: JSON.stringify(error.response.data, null, 2), status: error.response.status };
      } 
    }
    return { error: 'An unexpected error occurred', status: 500 }; // TODO: this is caos, it means that the API did not give us a proper response, sometimes having missing values triggers this, and we need to search in the stack of the backend   
  }
}

/**
 * Execute a query for a specific card and return the results.
 * @param sessionToken The session token obtained from authentication.
 * @param cardId The ID of the card for which the query is being executed.
 */
export async function executeQuery(sessionToken: string, cardId: number): Promise<any | { error: string; status: number }> {
  try {
    const response = await axios.post(
      `${METABASE_URL}/card/${cardId}/query/json`,
      {},
      {
        headers: {
          'X-Metabase-Session': sessionToken,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data; 

  } catch (error: any) {
    if (error.response) {
      console.log('error.response', error.response.data);
      return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
}
