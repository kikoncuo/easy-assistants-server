import axios from 'axios';
import Logger from '../utils/Logger';

const METABASE_URL = 'http://localhost:3000/api';  // Replace with your Metabase instance URL
const METABASE_USERNAME = 'test@omniloy.com';  // Replace with your Metabase username
const METABASE_PASSWORD = 'testomniloy2024';  // Replace with your Metabase password

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
export async function getSchema(sessionToken: string, databaseId: number): Promise<any> {
  const responseTables = await axios.get(`${METABASE_URL}/table`, {
    headers: {
      'X-Metabase-Session': sessionToken,
    },
  });
  const filteredTables = responseTables.data.filter((item: any) => item.db_id === databaseId)
    .map((item: any) => ({
      display_name: item.display_name,
      id: item.id
    }));

  const responseFields = await axios.get(`${METABASE_URL}/database/${databaseId}/fields`, {
    headers: {
      'X-Metabase-Session': sessionToken,
    },
  });

  return {
    tables: filteredTables,  
    fields: responseFields.data
  }; 
}

/**
 * Create a new card (question) in Metabase.
 * @param sessionToken The session token obtained from authentication.
 * @param schema The schema information obtained from the getSchema function.
 */
export async function createCard(sessionToken: string, cardData: any): Promise<number | { error: string; status: number }> {

  Logger.log('\n\ncardData', cardData); 
  cardData.visualization_settings = {};

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
      if (error.response.data["specific-errors"]) {
        return { error: JSON.stringify(error.response.data["specific-errors"], null, 2), status: error.response.status };
      } else if (error.response.data) {
        return { error: JSON.stringify(error.response.data, null, 2), status: error.response.status };
      } 
    }
    return { error: 'An unexpected error occurred', status: 500 };
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
      Logger.error('error.response', error.response.data);
      return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
}

/**
 * Hard delete a card by its ID.
 * @param sessionToken The session token obtained from authentication.
 * @param cardId The ID of the card to be deleted.
 */
export async function deleteCard(sessionToken: string, cardId: number): Promise<string | { error: string; status: number }> {
  try {
    const response = await axios.delete(`${METABASE_URL}/card/${cardId}`, {
      headers: {
        'X-Metabase-Session': sessionToken,
        'Content-Type': 'application/json',
      },
    });

    Logger.log('Card successfully deleted');
    return 'Card successfully deleted';

  } catch (error: any) {
    if (error.response) {
      Logger.error('Error deleting card :', error.response.data);
      return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
}

