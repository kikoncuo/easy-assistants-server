import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();
export const executeQuery = async (query: any, projectName: string) => {
  try {
      const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/api/executeQuery`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: query, projectName: projectName }),
      });

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log({executedData: data});
      return JSON.stringify(data);
  } catch (error) {
      console.error('Error executing query:', error);
      throw error;
  }
};
