// This is called in the server.ts file instead of a regular subgraph
import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { getDataStructure, getMissingValues, getUnusualValues, getDistinctValues, getGroupRatios, getDataSamples, getDuplicatedRows, getUniqueRatio, getEmptyValuePercentage } from '../utils/DataStructure';
import fetch from 'node-fetch';
import { insertRecommendations } from '../../tests/helpers';

import dotenv from 'dotenv';

dotenv.config();

const {CUBEJS_SERVER} = process.env;

interface SemanticLayerState extends BaseState {
  tableAnalysis: Record<string, TableAnalysis>;
  cubeJsFiles: Record<string, string>;
  finalResult: string;
  userConfirmations: Record<string, boolean>;
  dataStructure: string;
}

interface TableAnalysis {
  missingValues: Record<string, number>;
  unusualValues: Record<string, any[]>;
  recommendations: string[];
  distinctValues: Record<string, number>;
  groupRatios: Record<string, Record<string, number>>;
  dataSamples: Record<string, any[]>;
  duplicatedRows: number;
  uniqueRatio: Record<string, number>;
  emptyValuePercentage: Record<string, number>;
}

async function analyzeTables(state: SemanticLayerState, prefixes: string, pgConnectionChain: string, functions?: Function[]): Promise<SemanticLayerState> {
  const dataStructure = await getDataStructure(prefixes, pgConnectionChain);
  const tables = dataStructure.split('\n\n').filter(table => table.startsWith('Table:'));

  let tableAnalysis: Record<string, TableAnalysis> = {};

  for (const table of tables) {
      const cleanedTable = table.split(':')[1].trim();
      const tableName = cleanedTable.split('-')[0].trim();
      const cleanedColumns = table.split('\n').slice(1).map(col => col.split('(')[0].trim());
      const columns = table
    .split('\n')[1] 
    .split(';')     
    .map(col => col.trim()) 
    .filter(col => col !== '')  
    .map(col => {
      const match = col.match(/^\s*-\s*(\w+)/);  
      return match ? match[1] : '';
    })
    .filter(col => col !== '' && col !== '_' && col !== '_1'); 

    tableAnalysis[tableName] = {
      missingValues: await getMissingValues(tableName, columns, pgConnectionChain),
      unusualValues: await getUnusualValues(tableName, columns, pgConnectionChain),
      recommendations: [],
      distinctValues: await getDistinctValues(tableName, columns, pgConnectionChain),
      groupRatios: await getGroupRatios(tableName, columns, pgConnectionChain),
      dataSamples: await getDataSamples(tableName, columns, pgConnectionChain),
      duplicatedRows: await getDuplicatedRows(tableName, columns, pgConnectionChain),
      uniqueRatio: await getUniqueRatio(tableName, columns, pgConnectionChain),
      emptyValuePercentage: await getEmptyValuePercentage(tableName, columns, pgConnectionChain),
    };

    // Involve the user in the data analysis process
    const emptyFieldsMessage = `Table ${tableName} has the following percentage of empty fields:\n` +
      Object.entries(tableAnalysis[tableName].emptyValuePercentage)
        .map(([col, percentage]) => `${col}: ${percentage.toFixed(2)}%`)
        .join('\n');

        if(functions) {
          functions[0]('info', JSON.stringify({ message: emptyFieldsMessage }));
          functions[0]('input', JSON.stringify({ 
            message: "Please provide any insights or reasons for these empty fields:",
            key: `${tableName}_empty_fields_reason`
          }));
        }

    // Generate recommendations based on the analysis
    tableAnalysis[tableName].recommendations = generateRecommendations(tableAnalysis[tableName]);

    // Describe the data cleaning process to the user
    const cleaningDescription = describeDataCleaning(tableAnalysis[tableName]);
    if(functions) {
    functions[0]('info', JSON.stringify({ message: cleaningDescription }));
    functions[0]('input', JSON.stringify({ 
      message: "Do you approve of this data cleaning approach? (yes/no)",
      key: `${tableName}_cleaning_approval`
    }));
    }
  }

  return {
    ...state,
    tableAnalysis,
    dataStructure
  };
}

function generateRecommendations(analysis: TableAnalysis): string[] {
  const recommendations: string[] = [];

  // Add recommendations based on the analysis results
  const highEmptyPercentageColumns = Object.entries(analysis.emptyValuePercentage)
  .filter(([column, percentage]) => percentage > 10)
  .map(([column, percentage]) => `${column} (${percentage.toFixed(2)}%)`);

  if (highEmptyPercentageColumns.length > 0) {
    recommendations.push(`Consider handling missing values for the following columns with high empty percentages: ${highEmptyPercentageColumns.join(', ')}.`);
  }

  if (analysis.duplicatedRows > 0) {
    recommendations.push("Address duplicated rows in the dataset.");
  }

  Object.entries(analysis.uniqueRatio).forEach(([column, ratio]) => {
    if (ratio < 0.1) {
      recommendations.push(`'${column}' due to low unique ratio.`);
    }
  });

  // TODO: Talk with expert to add more recommendations based on other analysis results 

  return recommendations;
}

function describeDataCleaning(analysis: TableAnalysis): string {
  let description = "Based on the analysis, we recommend the following data cleaning steps:\n\n";

  if (Object.entries(analysis.emptyValuePercentage).some(([col, percentage]) => percentage > 0)) {
    description += "1. Handling missing values:\n";
    Object.entries(analysis.emptyValuePercentage).forEach(([col, percentage]) => {
      if (percentage > 0) {
        description += `   - For column '${col}' (${percentage.toFixed(2)}% empty): `;
        if (percentage < 5) {
          description += "Consider removing rows with missing values or imputing with median/mode.\n";
        } else if (percentage < 20) {
          description += "Impute missing values using advanced techniques like KNN or regression imputation.\n";
        }
      }
    });
  }

  if (analysis.duplicatedRows > 0) {
    description += `\n2. Duplicated rows: Remove ${analysis.duplicatedRows} duplicated rows from the dataset.\n`;
  }

  Object.entries(analysis.uniqueRatio).forEach(([column, ratio]) => {
    if (ratio < 0.1) {
      description += `\n3. Low unique ratio in '${column}': Consider grouping or binning values to reduce cardinality.\n`;
    }
  });

  // Todo: Add more cleaning steps based on other analysis results

  return description;
}

async function generateCubeJsFiles(state: SemanticLayerState): Promise<SemanticLayerState> {
  const filesSchema = z.object({ 
    files: z.record(z.string(), z.string()).describe('A record with the name of the files pointing to the content of the files')
  });
  const model = createStructuredResponseAgent(anthropicSonnet(), filesSchema);

  const tableAnalysisArray = Object.entries(state.tableAnalysis).map(([key, value]) => ({
    key,
    ...value
  }));

  const summarizedAnalysis = tableAnalysisArray.map((table: any) => ({
    name: table.key,
    recommendation: table.recommendations || null
  }));

  const updatedTableStrings = insertRecommendations(state.dataStructure, summarizedAnalysis);

  Logger.log('Updated table string', updatedTableStrings);

  const cubeJsFiles: Record<string, string> = {};
  const tablesPerIteration = 3;

  for (let i = 0; i < tableAnalysisArray.length; i += tablesPerIteration) {
    const currentTables = updatedTableStrings.split('\n\nTable: ')
      .slice(i + 1, i + tablesPerIteration + 1)
      .map(table => 'Table: ' + table.trim())
      .join('\n\n');

    const message = await model.invoke([
      new HumanMessage(`Generate Cube.js schema files for the following tables, each table contains the columns, type, 3 examples & additionally it can also contain recommendations:
      ${currentTables}
    
      Create a separate string per file for these cubes, handling the missing and unusual values as recommended.
    
      Crucial: Establish ALL relevant joins between cubes. For each table:
      1. Identify potential foreign keys (columns that might reference other tables).
      2. Create joins to all related tables using these keys.
      3. Include both one-to-many and many-to-many relationships where applicable.
      4. Use appropriate join types (e.g., belongsTo, hasMany, hasOne) based on the relationship.
      5. Ensure that every table is connected to the schema through at least one join.
    
      Define fields that may be useful for business analysis, including measures and dimensions.
      Make sure the types of the columns are accurate.
      Use best practices for Cube.js schema design, including appropriate naming conventions and annotations.
      Add the recommendations as a comment inside of that particular measure or dimension.
    
      For columns with a high percentage of empty values:
        - If the column data type is string: Replace empty values with "None" or "Missing".
        - If the column data type is numeric: Replace empty values with 0.
    
      After generating each cube, review it to ensure all possible joins are included. If a table seems to lack joins, reconsider its relationships with other tables and add the necessary joins.
      `)
    ]);

    Object.assign(cubeJsFiles, (message as any).files);
    Logger.log(`Generated schema for tables ${i + 1} to ${Math.min(i + tablesPerIteration, tableAnalysisArray.length)}`);
  }

  return {
    ...state,
    cubeJsFiles
  };
}

async function writeSemanticLayerFiles(state: SemanticLayerState): Promise<SemanticLayerState> {
  try {
    const company_name = "omni_test"
    const payload = {
      companyName: company_name,
      envVariables: "CUBEJS_DB_TYPE=postgres\nCUBEJS_DB_NAME=coffee_chain_db\n...", // This should be dynamically generated or passed in
      cubeFiles: {
        model: state.cubeJsFiles
      }
    };

    Logger.log('payload', payload)

    const response = await fetch(`${CUBEJS_SERVER}/company/create-company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });


    if (response.ok) {
      Logger.log('Semantic layer data posted successfully');
      return {
        ...state,
        finalResult: `Semantic layer data has been posted to the server successfully.`
      };
    } else {
      Logger.error('Failed to post semantic layer data:', response.statusText);
      return {
        ...state,
        finalResult: `Failed to post semantic layer data: ${response.statusText}`
      };
    }
  } catch (error) {
    Logger.error('Error posting semantic layer data:', error);
    return {
      ...state,
      finalResult: `Error posting semantic layer data`
    };
  }
}

export class SemanticLayerGraph extends AbstractGraph<SemanticLayerState> {
  private prefixes: string;
  private pgConnectionChain: string;
  private functions?: Function[];

  constructor(prefixes: string, pgConnectionChain: string, functions?: Function[]) {
    const graphState: StateGraphArgs<SemanticLayerState>['channels'] = {
      task: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      tableAnalysis: {
        value: (x: Record<string, TableAnalysis>, y?: Record<string, TableAnalysis>) => (y ? y : x),
        default: () => ({}),
      },
      cubeJsFiles: {
        value: (x: Record<string, string>, y?: Record<string, string>) => (y ? y : x),
        default: () => ({}),
      },
      finalResult: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
      userConfirmations: {
        value: (x: Record<string, boolean>, y?: Record<string, boolean>) => (y ? y : x),
        default: () => ({}),
      },
      dataStructure: {
        value: (x: string, y?: string) => (y ? y : x),
        default: () => '',
      },
    };
    super(graphState);
    this.prefixes = prefixes;
    this.pgConnectionChain = pgConnectionChain;
    this.functions = functions;
  }

  getGraph(): CompiledStateGraph<SemanticLayerState> {
    const subGraphBuilder = new StateGraph<SemanticLayerState>({ channels: this.channels });

    subGraphBuilder
      .addNode('analyze_tables', async state => await analyzeTables(state, this.prefixes, this.pgConnectionChain, this.functions))
      .addNode('generate_cubejs_files', async state => await generateCubeJsFiles(state))
      .addNode('write_semantic_layer_files', async state => await writeSemanticLayerFiles(state))
      .addEdge(START, 'analyze_tables')
      .addEdge('analyze_tables', 'generate_cubejs_files')
      .addEdge('generate_cubejs_files', 'write_semantic_layer_files')
      .addEdge('write_semantic_layer_files', END);

    return subGraphBuilder.compile();
  }
}