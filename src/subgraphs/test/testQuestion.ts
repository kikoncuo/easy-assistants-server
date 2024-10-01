import axios from 'axios';
import Logger from '../../utils/Logger';

/**
 * Fetch dataset as CSV from Metabase.
 * @param companyName The name of the company to get the configuration for.
 * @param sessionToken The session token obtained from authentication.
 */
export async function getDatasetAsCSV(): Promise<any | { error: string; status: number }> {
    // const config = ConfigurationManager.getConfig(companyName);
    
    const payload = {
      query: JSON.stringify({
        database: 1,
        query: { "source-table": 6 },
        type: "query",
        middleware: {
          "js-int-to-string?": true,
          "userland-query?": true,
          "add-default-userland-constraints?": true
        }
      })
    };
    
      console.log('payload', payload)
    let sessionToken;
    try {

        const response = await axios.post(`http://localhost:3000/api/session`, {
            username: "test@omniloy.com",
            password: "testomniloy2024"
          });
           sessionToken = response.data.id; 
           console.log('sessionToken', sessionToken)
    } catch (error: any) {
      Logger.error('Error fetching card details:', error);
      if (error.response) {
        return { error: error.response.data || 'Unknown error occurred', status: error.response.status };
      } else {
        return { error: 'An unexpected error occurred', status: 500 };
      }
    }

    try {
        const response = await axios.post(
            "http://localhost:3000/api/dataset/csv?format_rows=true",
          new URLSearchParams(payload).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              'X-Metabase-Session': sessionToken, // Replace with your session token
            },
          }
        );
    
        console.log('Data fetched successfully:', response.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
  
  }
  