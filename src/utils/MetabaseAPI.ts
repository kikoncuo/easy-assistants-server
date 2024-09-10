import axios from 'axios';
import Logger from '../utils/Logger';
import { ConfigurationManager } from './ConfigurationManager';

/**
 * Authenticate with Metabase and return a session token.
 * @param companyName The name of the company to get the configuration for.
 */
export async function authenticate(companyName: string): Promise<string> {
  const config = ConfigurationManager.getConfig(companyName);

  const response = await axios.post(`${config.METABASE_URL}/session`, {
    username: config.METABASE_USERNAME,
    password: config.METABASE_PASSWORD,
  });

  return response.data.id;  // Returns the session token
}

/**
 * Get the schema for a specific database.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param databaseId The ID of the database for which the schema is being requested.
 */
export async function getSchema(companyName: string, sessionToken: string, databaseId: number): Promise<any> {
  const config = ConfigurationManager.getConfig(companyName);

  const databaseMetadata = await axios.get(`${config.METABASE_URL}/database/${databaseId}/metadata`, {
    headers: {
      'X-Metabase-Session': sessionToken,
    },
    params: {
      "remove_inactive": true
    }
  });

  const tables = databaseMetadata.data.tables.map((table: any) => ({
    display_name: table.display_name,
    id: table.id,
    fields: table.fields.map((field: any) => ({
      id: field.id,
      name: field.name,
      fieldName: field.display_name,
      details: field.fingerprint ? JSON.stringify(field.fingerprint) : null
    }))
  }));

  return tables;
}
/**
 * Get details of a specific card (question) by its ID.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param cardId The ID of the card to fetch.
 */
export async function getCard(companyName: string, sessionToken: string, cardId: number): Promise<any | { error: string; status: number }> {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    const response = await axios.get(`${config.METABASE_URL}/card/${cardId}`, {
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
 * Fetch example cards for a given list of card IDs.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param cardIds The list of card IDs for which example cards are being fetched.
 */
export async function getExampleCards(companyName: string, sessionToken: string, cardIds: number[]): Promise<any> {
  const cardPayloads = [];
  let stringResponse = "";

  for (const cardId of cardIds) {
    try {
      const card = await getCard(companyName, sessionToken, cardId);

      if ('error' in card) {
        console.error(`Error fetching card ${cardId}:`, card.error);
        continue;
      }

      const cardPayload = {
        visualization_settings: card.visualization_settings || {},
        parameters: card.parameters || null,
        description: card.description || null,
        collection_position: card.collection_position || null,
        result_metadata: card.result_metadata || null,
        collection_id: card.collection_id || null,
        name: card.name,
        type: card.type || null,
        cache_ttl: card.cache_ttl || null,
        dataset_query: card.dataset_query || {},
        parameter_mappings: card.parameter_mappings || null,
        display: card.display || 'table'
      };

      cardPayloads.push(cardPayload);

      stringResponse = formatExampleCards(cardPayloads);

    } catch (error) {
      console.error(`Error getting example cards ${cardId}, we will use the fallback card. Error: ${error}`);
    }
  }

  return stringResponse;
}


/**
 * Create a new card (question) in Metabase.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param schema The schema information obtained from the getSchema function.
 */
export async function createCard(companyName: string, sessionToken: string, cardData: any): Promise<number | { error: string; status: number }> {
  const config = ConfigurationManager.getConfig(companyName);
  cardData.visualization_settings = {}; // TODO
  try {
  const response = await axios.post(`${config.METABASE_URL}/card`, cardData, {
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
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param cardId The ID of the card for which the query is being executed.
 */
export async function executeQuery(companyName: string, sessionToken: string, cardId: number): Promise<any | { error: string; status: number }> {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    const response = await axios.post(
      `${config.METABASE_URL}/card/${cardId}/query/json`,
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
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param cardId The ID of the card to be deleted.
 */
export async function deleteCard(companyName: string, sessionToken: string, cardId: number): Promise<string | { error: string; status: number }> {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    await axios.delete(`${config.METABASE_URL}/card/${cardId}`, {
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
 * Fetch values of a field
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param fieldId The ID of the field.
 */
export async function fetchFieldValues(companyName: string, sessionToken: string, fieldId: number): Promise<any> {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    const fieldValuesResponse = await axios.get(`${config.METABASE_URL}/field/${fieldId}/values`, {
      headers: {
        'X-Metabase-Session': sessionToken,
      },
    });
    
    return fieldValuesResponse.data.values.flat(1);
  } catch (error: any) {
    Logger.error('Error fetching field values:', error);
    return null;
  }
}

export const getCards = async (companyName: string, sessionToken: string, dbId: number): Promise<any> => {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    const response = await axios.get(`${config.METABASE_URL}/card/?f=database&model_id=${dbId}`, {
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

// In src/utils/MetabaseAPI.ts

export async function createDashboard(
  companyName: string,
  sessionToken: string,
  dashboardData: any,
  dashboardContent: any
): Promise<number | { error: string; status: number }> {
  try {
    Logger.log('Creating dashboard with data:', dashboardData);
    const config = ConfigurationManager.getConfig(companyName);
    // Step 1: Create the dashboard
    const createResponse = await axios.post(
      `${config.METABASE_URL}/dashboard`,
      dashboardData,
      {
        headers: {
          'X-Metabase-Session': sessionToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const dashboardId = createResponse.data.id;

    Logger.log('Dashboard created with ID:', dashboardId);
    Logger.log('Populating dashboard with content:', dashboardContent);

    // Step 2: Populate the dashboard with content
    const updateResponse = await axios.put(
      `${config.METABASE_URL}/dashboard/${dashboardId}`,
      dashboardContent,
      {
        headers: {
          'X-Metabase-Session': sessionToken,
          'Content-Type': 'application/json',
        },
      }
    );

    Logger.log('Dashboard created and populated successfully');
    Logger.log('Update response:', updateResponse.data);
    return dashboardId;

  } catch (error: any) {
    Logger.error('Error creating dashboard:', error);
    if (error.response) {
      return { 
        error: error.response.data || 'Unknown error occurred', 
        status: error.response.status 
      };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
}

function formatExampleCards(exampleCards: any[]): string {
  let formattedString = '';

  exampleCards.forEach((card, index) => {
    formattedString += `**Example ${index + 1}:**\n\n`;
    formattedString += `**Natural Language Query:**\n`;
    formattedString += `${card.description || 'No description available'}\n\n`;
    formattedString += `**JSON Representation:**\n`;
    formattedString += `${JSON.stringify(card, null, 2)}\n\n`;
  });

  return formattedString.trim();
}

/**
 * Sync the schema of a specific database in Metabase.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 * @param databaseId The ID of the database to sync.
 */
export async function syncDatabaseSchema(companyName: string, sessionToken: string, databaseId: number): Promise<string | { error: string; status: number }> {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    const response = await axios.post(
      `${config.METABASE_URL}/database/${databaseId}/sync_schema`,
      {},
      {
        headers: {
          'X-Metabase-Session': sessionToken,
          'Content-Type': 'application/json',
        },
      }
    );

    Logger.log(`Schema for database ${databaseId} successfully synced.`);
    return `Schema for database ${databaseId} successfully synced.`;

  } catch (error: any) {
    Logger.error('Error syncing database schema:', error);
    if (error.response) {
      return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
}

/**
 * Sync the schema of a specific database in Metabase.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 */
export async function getDatasetQuery(companyName: string, sessionToken: string, card:any): Promise<any | { error: string; status: number }> {
  const config = ConfigurationManager.getConfig(companyName);
  try {
    
    const response = await axios.post(
      `${config.METABASE_URL}/dataset`,
      card.datasetQuery,
      {
        headers: {
          'X-Metabase-Session': sessionToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data && 
      response.data.data && 
      Array.isArray(response.data.data) && 
      response.data.data.length > 0 ) {
        Logger.warn(`Error executing query: ${response.data}`);
        return { error: response.data, status: 500 };
      } 
      // Logger.log(`Response data for card ${card.id}`, response.data);
    return response.data; 

  } catch (error: any) {
    Logger.error('Error retieving dataset query:', error);
    if (error.response) {
      return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
    } else {
      return { error: 'An unexpected error occurred', status: 500 };
    }
  }
}