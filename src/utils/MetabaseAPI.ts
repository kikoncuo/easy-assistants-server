import axios from 'axios';
import Logger from '../utils/Logger';
import dotenv from 'dotenv';
dotenv.config();

const METABASE_URL = process.env.METABASE_URL;  
const METABASE_USERNAME = process.env.METABASE_USERNAME;  
const METABASE_PASSWORD = process.env.METABASE_PASSWORD;  

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

  const filteredTables = responseTables.data
    .filter((item: any) => item.db_id === databaseId)
    .map((item: any) => ({
      display_name: item.display_name,
      id: item.id,
      fields: [], // Initialize the fields array
    }));

  const responseFields = await axios.get(`${METABASE_URL}/database/${databaseId}/fields`, {
    headers: {
      'X-Metabase-Session': sessionToken,
    },
  });

  // Iterate over the fields and assign them to the corresponding table
  responseFields.data.forEach((field: any) => {
    const table = filteredTables.find((table: any) => table.display_name === field.table_name);

    if (table) {
      // Remove the schema field to save tokens
      const { schema, ...fieldWithoutSchema } = field;
      table.fields.push(fieldWithoutSchema);
    }
  });

  Logger.log('Combined tables and fields:', filteredTables);

  return filteredTables;
}

/**
 * Get details of a specific card (question) by its ID.
 * @param sessionToken The session token obtained from authentication.
 * @param cardId The ID of the card to fetch.
 */
export async function getCard(sessionToken: string, cardId: number): Promise<any | { error: string; status: number }> {
  try {
    const response = await axios.get(`${METABASE_URL}/card/${cardId}`, {
      headers: {
        'X-Metabase-Session': sessionToken,
        'Content-Type': 'application/json',
      },
    });

    return response.data; 

  } catch (error: any) {
    Logger.error('Error fetching card details:', error);
    if (error.response) {
      return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
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
        Logger.error('Couldn\'t identify the error type');
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
    Logger.log(`Response data for card ${cardId}`, response.data);
    if (response.data && 
      response.data.via && 
      Array.isArray(response.data.via) && 
      response.data.via.length > 0 && 
      response.data.via[0].error !== undefined) {
    Logger.warn(`Error executing query: ${response.data.via[0].error}`);
    return { error: response.data.via[0].error, status: 500 };
    } 
    return response.data; 

  } catch (error: any) {
    Logger.error('Error executing query:', error);
    if (error.response) {
      Logger.error('Got error response:', error.response.data);
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
    await axios.delete(`${METABASE_URL}/card/${cardId}`, {
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

/**
 * Fetch details of a field
 * @param sessionToken The session token obtained from authentication.
 * @param fieldId The ID of the field.
 */
export async function fetchFieldDetails(sessionToken: string, fieldId: number): Promise<any> {
  try {
    const fieldDetailsResponse = await axios.get(`${METABASE_URL}/field/${fieldId}`, {
      headers: {
        'X-Metabase-Session': sessionToken,
      },
    });
    const fieldValuesResponse = await axios.get(`${METABASE_URL}/field/${fieldId}/values`, {
      headers: {
        'X-Metabase-Session': sessionToken,
      },
    });
    
    return {
      fieldName: fieldDetailsResponse.data.display_name,
      details: fieldDetailsResponse.data.fingerprint ? JSON.stringify(fieldDetailsResponse.data.fingerprint ) : null,
      values: fieldValuesResponse.data.values
    };
  } catch (error: any) {
    Logger.error('Error fetching field details:', error);
    return null;
  }
}

export const getCards = async (sessionToken: string, dbId: number): Promise<any> => {
  try {
    const response = await axios.get(`${METABASE_URL}/card/?f=database&model_id=${dbId}`, {
      headers: {
        'X-Metabase-Session': sessionToken,
      },
    });
    const cardsData = response.data;

    let allCards: { [id: string]: { name: string; description: string, datasetQuery: string} } = {};

    for (const card of cardsData) {
      allCards[card.id] = {
        name: card.name,
        description: card.description,
        datasetQuery: JSON.stringify(card.dataset_query) // Convertimos el objeto dataset_query a un string
      };
    }

    return allCards;

  } catch (error) {
    console.warn(`Error fetching cards from API: ${error}`);
    throw error;
  }
};