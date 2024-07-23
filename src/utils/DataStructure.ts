import fetch from 'node-fetch';
import { Client } from 'pg';
import Logger from './Logger';
import dotenv from 'dotenv';
dotenv.config();

export const executeQuery = async (query: any, projectName: string) => {
  try {
    let continueWait = true;
    let data;
    while (continueWait) {
      const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/api/executeQuery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: JSON.stringify(query), projectName: projectName }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      data = await response.json();

      if (data.error && data.error === "Continue wait") {
        console.log(`Wait error - retry`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Timeout of 1 second
        continueWait = true;
      } else {
        continueWait = false;
      }
    }

    return JSON.stringify(data);
  } catch (error) {
    console.error('Error executing query:', error);
    throw error;
  }
};


export const getModelsData = async (projectName: string): Promise<string[]> => {
  try {
      const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/api/getMeta?projectName=${projectName}`, {
          method: 'GET',
          headers: {
              'Content-Type': 'application/json'
          }
      });

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const cubesStrings = data.cubes.map((cube: any) => JSON.stringify(cube));

      return cubesStrings;
  } catch (error) {
      console.error('Error executing query:', error);
      throw error;
  }
};

export const getSQLQuery = async (projectName: string, query: any): Promise<string[]> => {
  try {
      const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/api/getQuery?projectName=${projectName}&query=${query}`, {
          method: 'GET',
          headers: {
              'Content-Type': 'application/json'
          }
      });

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const sqlString = data.sql.sql;

      return sqlString;
  } catch (error) {
      console.error('Error executing query:', error);
      throw error;
  }
};

const viewPrefix = 'view_';

interface Column {
  column_name: string;
  data_type: string;
}

interface TableReport {
  tableName: string;
  structureAndExamples: Array<{
    column_name: string;
    data_type: string;
    example_values: string[];
  }>;
}

interface ViewReport {
  viewName: string;
  structureAndExamples: Array<{
    column_name: string;
    data_type: string;
    example_values: string[];
  }>;
}

async function getTableNames(prefixes: string, client: Client): Promise<string[]> {
  try {
    let tablePrefixes;
    if(prefixes) {
      tablePrefixes = prefixes.split(',');
    }
    const prefixConditions = tablePrefixes?.map((prefix: string) => `tablename LIKE '${prefix}%'`).join(' OR ');
    Logger.log({prefixConditions});

    const res = await client.query(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public' AND (${prefixConditions});
        `);
    return res.rows.map((row: { tablename: any }) => row.tablename);
  } catch (error) {
    console.warn(`Error executing query to get table names: ${error}`);
    throw error;
  }
}

async function getViewNames(client: Client): Promise<string[]> {
  try {
    const res = await client.query(`
            SELECT viewname
            FROM pg_views
            WHERE schemaname = 'public' AND viewname LIKE '${viewPrefix}%';
        `);
    return res.rows.map((row: { viewname: any }) => row.viewname);
  } catch (error) {
    console.warn(`Error executing query to get view names: ${error}`);
    throw error;
  }
}

async function getColumns(client: Client, tableName: string): Promise<Column[]> {
  const query = `
        SELECT
            column_name,
            data_type
        FROM
            information_schema.columns
        WHERE
            table_name = $1;
    `;
  try {
    const res = await client.query(query, [tableName]);
    return res.rows;
  } catch (error) {
    console.warn(`Error executing query to get columns for table ${tableName}: ${error}\nQuery: ${query}`);
    throw error;
  }
}

async function getExampleValues(client: Client, tableName: string, columnName: string): Promise<string[]> {
  const query = `
        SELECT DISTINCT "${columnName}"
        FROM "${tableName}"
        WHERE "${columnName}" IS NOT NULL
        LIMIT 3;
    `;
  try {
    const res = await client.query(query);
    return res.rows.map((row: { [x: string]: any }) => row[columnName]);
  } catch (error) {
    console.warn(
      `Error executing query to get example values for column ${columnName} in table ${tableName}: ${error}\nQuery: ${query}`,
    );
    return [];
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '...';
  }
  return text;
}

async function getStructureAndExamples(
  client: Client,
  name: string,
  isView: boolean = false,
): Promise<Array<{ column_name: string; data_type: string; example_values: string[] }>> {
  try {
    const columns = await getColumns(client, name);

    const results = [];
    for (const column of columns) {
      const exampleValues = await getExampleValues(client, name, column.column_name);
      results.push({
        column_name: column.column_name,
        data_type: column.data_type,
        example_values: exampleValues,
      });
    }

    return results;
  } catch (error) {
    console.warn(`Error getting structure and examples for ${isView ? 'view' : 'table'} ${name}: ${error}`);
    return [];
  }
}

export async function getDataStructure(prefixes: string, pgConnectionString?: string): Promise<string> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  const tableReport: TableReport[] = [];
  const viewReport: ViewReport[] = [];

  try {
    const tableNames = await getTableNames(prefixes, client);
    for (const tableName of tableNames) {
      const structureAndExamples = await getStructureAndExamples(client, tableName);
      tableReport.push({ tableName, structureAndExamples });
    }

    const viewNames = await getViewNames(client);
    for (const viewName of viewNames) {
      const structureAndExamples = await getStructureAndExamples(client, viewName, true);
      viewReport.push({ viewName, structureAndExamples });
    }

    const tableReportText = tableReport
      .map(report => {
        const tableHeader = `Table: ${report.tableName}\n`;
        const columnsDetail = report.structureAndExamples
          .map(col => {
            const exampleValuesStr = JSON.stringify(col.example_values);
            const truncatedExampleValuesStr = truncateText(exampleValuesStr, 150);
            return ` - ${col.column_name} (${col.data_type}): ${truncatedExampleValuesStr}`;
          })
          .join('; ');
        return tableHeader + columnsDetail;
      })
      .join('\n\n');

    const viewReportText = viewReport
      .map(report => {
        const viewHeader = `View: ${report.viewName}\n`;
        const columnsDetail = report.structureAndExamples
          .map(col => {
            const exampleValuesStr = JSON.stringify(col.example_values);
            const truncatedExampleValuesStr = truncateText(exampleValuesStr, 150);
            return ` - ${col.column_name} (${col.data_type}): ${truncatedExampleValuesStr}`;
          })
          .join('; ');
        return viewHeader + columnsDetail;
      })
      .join('\n\n');

    const reportText = `Tables:\n\n${tableReportText}\n\nViews:\n\n${viewReportText}`;

    return reportText;
  } catch (err) {
    console.error('Error during execution', err);
    return '';
  } finally {
    await client.end();
  }
}

export async function executeQueries(queries: string[], pgConnectionString?: string): Promise<string[]> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  const results: string[] = [];

  try {
    for (const query of queries) {
      try {
        const res = await client.query(query);
        results.push(JSON.stringify(res.rows, null, 2));
      } catch (error) {
        console.warn(`Error executing query: ${query}\nError: ${error}`);
        results.push(`Error executing query: ${error}`);
      }
    }
  } finally {
    await client.end();
  }

  return results;
}

export async function dropSQLFunction(functionName: string, pgConnectionString?: string): Promise<string> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  const query = `DROP FUNCTION IF EXISTS ${functionName} CASCADE;`;

  try {
    await client.query(query);
    return `Function ${functionName} dropped successfully.`;
  } catch (error) {
    console.warn(`Error dropping function ${functionName}: ${error}`);
    return `Error dropping function ${functionName}: ${error}`;
  } finally {
    await client.end();
  }
}

export async function createPLV8function(query: string, functionName: string, pgConnectionString?: string): Promise<string> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    await client.query(query);
    const execution =  await client.query(`select * from ${functionName}() limit 10`);
    return JSON.stringify(execution.rows);
  } catch (error) {
    console.warn(`Error creating function ${error}`);
    return `Error creating function  ${error}`;
  } finally {
    await client.end();
  }
}

export async function getMissingValues(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, number>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const missingValues: Record<string, number> = {};
    for (const column of columns) {
      const query = `SELECT COUNT(*) FROM "${tableName}" WHERE "${column}" IS NULL`;
      const result = await client.query(query);
      missingValues[column] = parseInt(result.rows[0].count);
    }
    return missingValues;
  } catch (error) {
    console.warn(`Error getting missing values for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

export async function getUnusualValues(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, any[]>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const unusualValues: Record<string, any[]> = {};
    for (const column of columns) {
      const query = `
        SELECT "${column}", COUNT(*) as count
        FROM "${tableName}"
        GROUP BY "${column}"
        ORDER BY count ASC
        LIMIT 5
      `;
      const result = await client.query(query);
      unusualValues[column] = result.rows.map(row => row[column]);
    }
    return unusualValues;
  } catch (error) {
    console.warn(`Error getting unusual values for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

export async function getDistinctValues(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, number>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const distinctValues: Record<string, number> = {};
    for (const column of columns) {
      const query = `SELECT COUNT(DISTINCT "${column}") FROM "${tableName}"`;
      const result = await client.query(query);
      distinctValues[column] = parseInt(result.rows[0].count);
    }
    return distinctValues;
  } catch (error) {
    console.warn(`Error getting distinct values for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

export async function getGroupRatios(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, Record<string, number>>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const groupRatios: Record<string, Record<string, number>> = {};
    for (const column of columns) {
      const query = `
        SELECT "${column}", COUNT(*) * 100.0 / (SELECT COUNT(*) FROM "${tableName}") AS ratio
        FROM "${tableName}"
        GROUP BY "${column}"
        ORDER BY ratio DESC
        LIMIT 5
      `;
      const result = await client.query(query);
      groupRatios[column] = result.rows.reduce((acc, row) => {
        acc[row[column]] = parseFloat(row.ratio);
        return acc;
      }, {});
    }
    return groupRatios;
  } catch (error) {
    console.warn(`Error getting group ratios for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

export async function getDataSamples(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, any[]>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const dataSamples: Record<string, any[]> = {};
    for (const column of columns) {
      const query = `
        SELECT DISTINCT "${column}"
        FROM "${tableName}"
        WHERE "${column}" IS NOT NULL
        LIMIT 5
      `;
      const result = await client.query(query);
      dataSamples[column] = result.rows.map(row => row[column]);
    }
    return dataSamples;
  } catch (error) {
    console.warn(`Error getting data samples for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

export async function getDuplicatedRows(tableName: string,  columns:string[], pgConnectionString?: string): Promise<number> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    let query;
  if (columns.length === 1) {
    query = `
      SELECT COUNT(*) - COUNT(DISTINCT ${columns[0]}) AS duplicated_rows
      FROM "${tableName}"
    `;
  } else {
    const concatColumns = columns.map(col => `COALESCE(${col}::text, '')`).join(" || ");
    query = `
      SELECT COUNT(*) - COUNT(DISTINCT (${concatColumns})) AS duplicated_rows
      FROM "${tableName}"
    `;
  }
    const result = await client.query(query);
    return parseInt(result.rows[0].duplicated_rows);
  } catch (error) {
    console.warn(`Error getting duplicated rows for table ${tableName}: ${error}`);
    return 0;
  } finally {
    await client.end();
  }
}

export async function getUniqueRatio(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, number>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const uniqueRatio: Record<string, number> = {};
    for (const column of columns) {
      const query = `
        SELECT COUNT(DISTINCT "${column}") * 1.0 / COUNT(*) AS unique_ratio
        FROM "${tableName}"
      `;
      const result = await client.query(query);
      uniqueRatio[column] = parseFloat(result.rows[0].unique_ratio);
    }
    return uniqueRatio;
  } catch (error) {
    console.warn(`Error getting unique ratio for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

export async function getEmptyValuePercentage(tableName: string, columns: string[], pgConnectionString?: string): Promise<Record<string, number>> {
  const client = new Client({
    connectionString: pgConnectionString ?? process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    const emptyValuePercentage: Record<string, number> = {};
    for (const column of columns) {
      const query = `
        SELECT COUNT(*) * 100.0 / (SELECT COUNT(*) FROM "${tableName}") AS empty_percentage
        FROM "${tableName}"
        WHERE "${column}" IS NULL
      `;
      const result = await client.query(query);
      emptyValuePercentage[column] = parseFloat(result.rows[0].empty_percentage);
    }
    return emptyValuePercentage;
  } catch (error) {
    console.warn(`Error getting empty value percentage for table ${tableName}: ${error}`);
    return {};
  } finally {
    await client.end();
  }
}

