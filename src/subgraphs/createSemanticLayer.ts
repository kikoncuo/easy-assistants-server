// This is called in the server.ts file instead of a regular subgraph
import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { getDataStructure, getMissingValues, getUnusualValues, getDistinctValues, getGroupRatios, getDataSamples, getDuplicatedRows, getUniqueRatio, getEmptyValuePercentage } from '../utils/DataStructure';
import fs from 'fs';
import path from 'path';

interface SemanticLayerState extends BaseState {
  tableAnalysis: Record<string, TableAnalysis>;
  cubeJsFiles: Record<string, string>;
  finalResult: string;
  userConfirmations: Record<string, boolean>;
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

async function analyzeTables(state: SemanticLayerState, prefixes: string, pgConnectionChain: string, functions: Function[]): Promise<SemanticLayerState> {
  const dataStructure = await getDataStructure(prefixes, pgConnectionChain);
  const tables = dataStructure.split('\n\n').filter(table => table.startsWith('Table:'));

  let tableAnalysis: Record<string, TableAnalysis> = {};

  for (const table of tables) {
    const tableName = table.split(':')[1].trim();
    const columns = table.split('\n').slice(1).map(col => col.split('(')[0].trim());

    tableAnalysis[tableName] = {
      missingValues: await getMissingValues(tableName, columns, pgConnectionChain),
      unusualValues: await getUnusualValues(tableName, columns, pgConnectionChain),
      recommendations: [],
      distinctValues: await getDistinctValues(tableName, columns, pgConnectionChain),
      groupRatios: await getGroupRatios(tableName, columns, pgConnectionChain),
      dataSamples: await getDataSamples(tableName, columns, pgConnectionChain),
      duplicatedRows: await getDuplicatedRows(tableName, pgConnectionChain),
      uniqueRatio: await getUniqueRatio(tableName, columns, pgConnectionChain),
      emptyValuePercentage: await getEmptyValuePercentage(tableName, columns, pgConnectionChain),
    };

    // Involve the user in the data analysis process
    const emptyFieldsMessage = `Table ${tableName} has the following percentage of empty fields:\n` +
      Object.entries(tableAnalysis[tableName].emptyValuePercentage)
        .map(([col, percentage]) => `${col}: ${percentage.toFixed(2)}%`)
        .join('\n');

    functions[0]('info', JSON.stringify({ message: emptyFieldsMessage }));
    functions[0]('input', JSON.stringify({ 
      message: "Please provide any insights or reasons for these empty fields:",
      key: `${tableName}_empty_fields_reason`
    }));

    // Generate recommendations based on the analysis
    tableAnalysis[tableName].recommendations = generateRecommendations(tableAnalysis[tableName]);

    // Describe the data cleaning process to the user
    const cleaningDescription = describeDataCleaning(tableAnalysis[tableName]);
    functions[0]('info', JSON.stringify({ message: cleaningDescription }));
    functions[0]('input', JSON.stringify({ 
      message: "Do you approve of this data cleaning approach? (yes/no)",
      key: `${tableName}_cleaning_approval`
    }));
  }

  return {
    ...state,
    tableAnalysis
  };
}

function generateRecommendations(analysis: TableAnalysis): string[] {
  const recommendations: string[] = [];

  // Add recommendations based on the analysis results
  if (Object.values(analysis.emptyValuePercentage).some(percentage => percentage > 10)) {
    recommendations.push("Consider handling missing values for columns with high empty percentages.");
  }

  if (analysis.duplicatedRows > 0) {
    recommendations.push("Address duplicated rows in the dataset.");
  }

  Object.entries(analysis.uniqueRatio).forEach(([column, ratio]) => {
    if (ratio < 0.1) {
      recommendations.push(`Consider grouping or binning values in column '${column}' due to low unique ratio.`);
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
  const getCubeJsFiles = z.object({
    cubeJsFiles: z.record(z.string(), z.string())
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getCubeJsFiles);

  const message = await model.invoke([
    new HumanMessage(`Generate Cube.js schema files for the following analyzed tables:
    ${JSON.stringify(state.tableAnalysis, null, 2)}
    
    Create a separate file for each table, handling the missing and unusual values as recommended.
    Establish all relevant joins between tables and define fields that may be useful for business analysis.
    Use best practices for Cube.js schema design, including appropriate naming conventions and annotations.`)
  ]);

  const cubeJsFiles = (message as any).cubeJsFiles;
  Logger.log('Generated Cube.js files:', Object.keys(cubeJsFiles));

  return {
    ...state,
    cubeJsFiles
  };
}

async function writeSemanticLayerFiles(state: SemanticLayerState): Promise<SemanticLayerState> {
  const outputDir = path.join(process.cwd(), 'semantic_layer'); // TODO: Use a configurable output directory based on the company data
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const [fileName, fileContent] of Object.entries(state.cubeJsFiles)) {
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, fileContent);
  }

  return {
    ...state,
    finalResult: `Semantic layer files have been created in the 'semantic_layer' directory. Files: ${Object.keys(state.cubeJsFiles).join(', ')}`
  };
}

export class SemanticLayerGraph extends AbstractGraph<SemanticLayerState> {
  private prefixes: string;
  private pgConnectionChain: string;
  private functions: Function[];

  constructor(prefixes: string, pgConnectionChain: string, functions: Function[]) {
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
