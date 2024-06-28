import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

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
        const tablePrefixes = prefixes.split(",");
        const prefixConditions = tablePrefixes.map((prefix: string) => `tablename LIKE '${prefix}%'`).join(' OR ');

        const res = await client.query(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public' AND (${prefixConditions});
        `);
        return res.rows.map((row: { tablename: any; }) => row.tablename);
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
        return res.rows.map((row: { viewname: any; }) => row.viewname);
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
        return res.rows.map((row: { [x: string]: any; }) => row[columnName]);
    } catch (error) {
        console.warn(`Error executing query to get example values for column ${columnName} in table ${tableName}: ${error}\nQuery: ${query}`);
        return [];
    }
}

function truncateText(text: string, maxLength: number): string {
    if (text.length > maxLength) {
        return text.slice(0, maxLength) + '...';
    }
    return text;
}

async function getStructureAndExamples(client: Client, name: string, isView: boolean = false): Promise<Array<{ column_name: string; data_type: string; example_values: string[] }>> {
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
        console.log({tableNames})
        for (const tableName of tableNames) {
            const structureAndExamples = await getStructureAndExamples(client, tableName);
            tableReport.push({ tableName, structureAndExamples });
        }

        const viewNames = await getViewNames(client);
        for (const viewName of viewNames) {
            const structureAndExamples = await getStructureAndExamples(client, viewName, true);
            viewReport.push({ viewName, structureAndExamples });
        }

        const tableReportText = tableReport.map(report => {
            const tableHeader = `Table: ${report.tableName}\n`;
            const columnsDetail = report.structureAndExamples.map(col => {
                const exampleValuesStr = JSON.stringify(col.example_values);
                const truncatedExampleValuesStr = truncateText(exampleValuesStr, 150);
                return ` - ${col.column_name} (${col.data_type}): ${truncatedExampleValuesStr}`;
            }).join('; ');
            return tableHeader + columnsDetail;
        }).join('\n\n');

        const viewReportText = viewReport.map(report => {
            const viewHeader = `View: ${report.viewName}\n`;
            const columnsDetail = report.structureAndExamples.map(col => {
                const exampleValuesStr = JSON.stringify(col.example_values);
                const truncatedExampleValuesStr = truncateText(exampleValuesStr, 150);
                return ` - ${col.column_name} (${col.data_type}): ${truncatedExampleValuesStr}`;
            }).join('; ');
            return viewHeader + columnsDetail;
        }).join('\n\n');

        const reportText = `Tables:\n\n${tableReportText}\n\nViews:\n\n${viewReportText}`;

        return reportText;
        
    } catch (err) {
        console.error('Error during execution', err);
        return "";
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
                results.push( `Error executing query: ${error}`);
            }
        }
    } finally {
        await client.end();
    }

    return results;
}