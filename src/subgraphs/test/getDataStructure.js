require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const tablePrefix = 'at_';
const viewPrefix = 'zz_';

async function getTableNames(client) {
    try {
        const res = await client.query(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public' AND tablename LIKE '${tablePrefix}%';
        `);
        return res.rows.map(row => row.tablename);
    } catch (error) {
        console.warn(`Error executing query to get table names: ${error.message}`);
        throw error;
    }
}

async function getViewNames(client) {
    try {
        const res = await client.query(`
            SELECT viewname
            FROM pg_views
            WHERE schemaname = 'public' AND viewname LIKE '${viewPrefix}%';
        `);
        return res.rows.map(row => row.viewname);
    } catch (error) {
        console.warn(`Error executing query to get view names: ${error.message}`);
        throw error;
    }
}

async function getColumns(client, tableName) {
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
        console.warn(`Error executing query to get columns for table ${tableName}: ${error.message}\nQuery: ${query}`);
        throw error;
    }
}

async function getExampleValues(client, tableName, columnName) {
    const query = `
        SELECT DISTINCT "${columnName}"
        FROM "${tableName}"
        WHERE "${columnName}" IS NOT NULL
        LIMIT 3;
    `;
    try {
        const res = await client.query(query);
        return res.rows.map(row => row[columnName]);
    } catch (error) {
        console.warn(`Error executing query to get example values for column ${columnName} in table ${tableName}: ${error.message}\nQuery: ${query}`);
        return null;
    }
}

function truncateText(text, maxLength) {
    if (text.length > maxLength) {
        return text.slice(0, maxLength) + '...';
    }
    return text;
}

async function getStructureAndExamples(client, name, isView = false) {
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
        console.warn(`Error getting structure and examples for ${isView ? 'view' : 'table'} ${name}: ${error.message}`);
        return [];
    }
}

async function main() {
    const client = new Client({
        connectionString: process.env.PG_CONNECTION_STRING,
    });

    await client.connect();

    const tableReport = [];
    const viewReport = [];

    try {
        const tableNames = await getTableNames(client);
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
        
        const outputPath = path.join(__dirname, 'structure_report.txt');
        fs.writeFileSync(outputPath, reportText);

        console.log(`Report written to ${outputPath}`);
    } catch (err) {
        console.error('Error during execution', err.stack);
    } finally {
        await client.end();
    }
}

main();
