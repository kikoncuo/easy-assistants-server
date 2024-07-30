// This is called in the server.ts file instead of a regular subgraph
import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { getDataStructure, getMissingValues, getUnusualValues, getDistinctValues, getGroupRatios, getDataSamples, getDuplicatedRows, getUniqueRatio, getEmptyValuePercentage } from '../utils/DataStructure';
import { getConnectionChain, insertRecommendations } from '../../tests/helpers';
import { ToolDefinition } from '@langchain/core/language_models/base';

import dotenv from 'dotenv';

dotenv.config();

interface SemanticLayerState extends BaseState {
  tableAnalysis: Record<string, TableAnalysis>;
  cubeJsFiles: Record<string, string>;
  finalResult: string;
  userConfirmations: Record<string, boolean>;
  dataStructure: string;
  recommendationOptions: Record<string, { option1: string; option2: string }>;
  selectedRecommendations: Record<string, string>
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

interface Recommendation {
  options: string[];
}

interface RecommendationOptions {
  [tableName: string]: Recommendation;
}

async function analyzeTables(state: SemanticLayerState, prefixes: string, company_name: string, functions: Function[]): Promise<SemanticLayerState> {
  const pgConnectionChain = getConnectionChain(company_name)
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

    const emptyFieldsMessage = `Table ${tableName} has the following percentage of empty fields:\n` +
      Object.entries(tableAnalysis[tableName].emptyValuePercentage)
        .map(([col, percentage]) => `${col}: ${percentage.toFixed(2)}%`)
        .join('\n');

    // Generate recommendations based on the analysis
    tableAnalysis[tableName].recommendations = generateRecommendations(tableAnalysis[tableName]);
    
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

async function generateRecommendationOptions(state: SemanticLayerState): Promise<SemanticLayerState> {
  // const optionsSchema = z.object({
  //   RecommendationOptions: z.record(z.object({
  //     options: z.array(z.string()).length(2).describe('Array of two possible recommendation options'),
  //   }))
  // });

  // const model = createStructuredResponseAgent(anthropicSonnet(), optionsSchema);

  const recommendationOptionsSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "getRecommendationOptions",
      description: "Get recommendation options for a given scenario",
      parameters: {
        type: "object",
        properties: {
          RecommendationOptions: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                options: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 2,
                  maxItems: 2,
                  description: "Array of two possible recommendation options"
                }
              },
              required: ["options"]
            }
          }
        },
        required: ["RecommendationOptions"]
      }
    }
  };
  
  const model = createStructuredResponseAgent(anthropicSonnet(), [recommendationOptionsSchema]);

  const recommendations = Object.entries(state.tableAnalysis).reduce((acc, [tableName, analysis]) => {
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      acc[tableName] = analysis.recommendations;
    }
    return acc;
  }, {} as Record<string, string[]>);

  const message = await model.invoke([
    new HumanMessage(`Given the following recommendations for each table:
      ${JSON.stringify(recommendations, null, 2)}
      
      For each table's recommendations, provide two distinct approaches to address the issues mentioned.
      Return the options in the following format:
      {
        "RecommendationOptions": {
          "table_name1": {
            "options": ["Description of first option", "Description of second option"]
          },
          "table_name2": {
            "options": ["Description of first option", "Description of second option"]
          },
          ...
        }
      }
      Ensure that each table name is a key in the RecommendationOptions object, and each table has exactly two options in its options array.`)
  ]);

  const recommendationOptions = message as unknown as { RecommendationOptions: RecommendationOptions };

  type TransformedOptions = Record<string, { option1: string; option2: string }>;

  // Transform the data structure to match the expected RecommendationOptions format
  const transformedOptions = Object.entries(recommendationOptions.RecommendationOptions).reduce<TransformedOptions>((acc, [tableName, value]) => {
    if (value && Array.isArray(value.options) && value.options.length === 2) {
      acc[tableName] = {
        option1: value.options[0],
        option2: value.options[1]
      };
    } else {
      console.warn(`Unexpected structure for table ${tableName}:`, value);
    }
    return acc;
  }, {} as TransformedOptions);

  return {
    ...state,
    recommendationOptions: transformedOptions
  };
}

async function selectRecommendations(state: SemanticLayerState, functions: Function[]): Promise<SemanticLayerState> {
  // const optionsSchema = z.object({
  //   SelectedRecommendation: z.string().describe('The selected recommendation based on user input')
  // });

  // const model = createStructuredResponseAgent(anthropicSonnet(), optionsSchema);
  const selectedRecommendationSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "getSelectedRecommendation",
      description: "Get the selected recommendation based on user input",
      parameters: {
        type: "object",
        properties: {
          SelectedRecommendation: {
            type: "string",
            description: "The selected recommendation based on user input"
          }
        },
        required: ["SelectedRecommendation"]
      }
    }
  };
  
  const model = createStructuredResponseAgent(anthropicSonnet(), [selectedRecommendationSchema]);

  const selectedRecommendations: Record<string, string> = {};

  for (const [tableName, options] of Object.entries(state.recommendationOptions)) {
    const approveSuggestion = [
      {
        function_name: 'approveSuggestion',
        arguments: {
          approveSuggestion: `For table ${tableName}, consider these options:
            1: ${options.option1}
            2: ${options.option2}
            Please describe your preference or any modifications you'd like:`
        },
      },
    ];

    const userResponse = await functions[0]('tool', approveSuggestion);
    const userInput = JSON.parse(userResponse.approveSuggestion);

    const message = await model.invoke([
      new HumanMessage(`Given the following options for table ${tableName}:
        Option 1: ${options.option1}
        Option 2: ${options.option2}

        And the user's input: "${userInput}"

        Determine which option the user prefers or if they suggest a modification.
        If it's a modification, adapt the closest matching option.
        Return the selected or adapted recommendation.`)
    ]);

    const aiSelection = message as unknown as { SelectedRecommendation: string };
    selectedRecommendations[tableName] = aiSelection.SelectedRecommendation;

  }

  return {
    ...state,
    selectedRecommendations
  };
}


async function generateCubeJsFiles(state: SemanticLayerState): Promise<SemanticLayerState> {
  // const filesSchema = z.object({ 
  //   files: z.record(z.string(), z.string()).describe('A record with the name of the files pointing to the content of the files')
  // });
  // const model = createStructuredResponseAgent(anthropicSonnet(), filesSchema);

  const filesSchema: ToolDefinition = {
    type: "function",
    function: {
      name: "getFiles",
      description: "Get a record of file names and their contents",
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "object",
            additionalProperties: {
              type: "string"
            },
            description: "A record with the name of the files pointing to the content of the files"
          }
        },
        required: ["files"]
      }
    }
  };
  
  const model = createStructuredResponseAgent(anthropicSonnet(), [filesSchema]);

  const tableAnalysisArray = Object.entries(state.tableAnalysis).map(([key, value]) => ({
    key,
    ...value
  }));

  // Create an array of objects with table names and their selected recommendations
  const selectedRecommendationsArray = Object.entries(state.selectedRecommendations).map(([tableName, recommendation]) => ({
    name: tableName,
    recommendation: [recommendation]
  }));

  // Use selectedRecommendations instead of the original recommendations
  const updatedTableStrings = insertRecommendations(state.dataStructure, selectedRecommendationsArray);

  const cubeJsFiles: Record<string, string> = {};
  const tablesPerIteration = 1;

  for (let i = 0; i < tableAnalysisArray.length; i += tablesPerIteration) {
    const currentTables = updatedTableStrings.split('\n\nTable: ')
      .slice(i + 1, i + tablesPerIteration + 1)
      .map(table => 'Table: ' + table.trim())
      .join('\n\n');

    const message = await model.invoke([
      new HumanMessage(`Generate Cube.js schema files for the following tables, each table contains the columns, type, 3 examples & additionally it can also contain recommendations:
      ${currentTables}
    
      Create a separate string per file for these cubes, handling the missing and unusual values as recommended.

      While generating the Cube.js schema files, use the cube name as the file name, maintaining its original letter case and adding a .js extension.
    
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

      For each measure and dimension, include a 'description' parameter that explains:
      1. The purpose of the field
      2. How it's calculated (for measures)
      3. Its significance in business analysis
      4. Any important considerations when using this field
    
      After generating each cube, review it to ensure all possible joins are included. If a table seems to lack joins, reconsider its relationships with other tables and add the necessary joins.

      Important: For each file, add a detailed comment block at the end explaining:
      1. How the joins were created
      2. The reasoning behind each join
      3. Any assumptions made about the relationships between tables
      4. Potential alternative join strategies that could be considered

      Format this explanation as a multi-line comment using /* */.
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

async function writeSemanticLayerFiles(state: SemanticLayerState, company_name: string, functions: Function[]): Promise<SemanticLayerState> {
  try {
    const payload = {
      companyName: company_name,
      envVariables: "CUBEJS_DB_TYPE=postgres\nCUBEJS_DB_NAME=coffee_chain_db\n...", // This should be dynamically generated or passed in
      cubeFiles: {
        model: state.cubeJsFiles
      }
    };

    const semanticLayerDetails = Object.entries(state.cubeJsFiles).map(([fileName, fileContent]) => {
      const cube = fileContent
      return {
        fileName,
        cube: {
          cube
        }
      };
    });

    const reviewSemanticLayer = [
      {
        function_name: 'reviewSemanticLayer',
        arguments: {
          reviewSemanticLayer: ({
            message: `Your new semantic layer is ready for review:`,
            companyName: company_name,
            modelCount: Object.keys(state.cubeJsFiles).length,
            semanticLayerDetails
          })
        },
      },
    ];

    functions[0]('tool', reviewSemanticLayer);

    const response = await fetch(`${process.env.CUBE_API_SERVER_URL}/company/create-company`, {
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
  private functions: Function[];
  private company_name: string;

  constructor(prefixes: string, company_name: string, functions: Function[]) {
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
      recommendationOptions: {
        value: (x: Record<string, { option1: string; option2: string }>, y?: Record<string, { option1: string; option2: string }>) => (y ? y : x),
        default: () => ({}),
      },      
      selectedRecommendations: {
        value: (x: Record<string, string>, y?: Record<string, string>) => (y ? y : x),
        default: () => ({}),
      },
    };
    super(graphState);
    this.prefixes = prefixes;
    this.functions = functions;
    this.company_name = company_name;
  }

  getGraph(): CompiledStateGraph<SemanticLayerState> {
    const subGraphBuilder = new StateGraph<SemanticLayerState>({ channels: this.channels });

    subGraphBuilder
      .addNode('analyze_tables', async state => await analyzeTables(state, this.prefixes, this.company_name, this.functions))
      .addNode('generate_recommendation_options', async state => await generateRecommendationOptions(state))
      .addNode('select_recommendations', async state => await selectRecommendations(state, this.functions))
      .addNode('generate_cubejs_files', async state => await generateCubeJsFiles(state))
      .addNode('write_semantic_layer_files', async state => await writeSemanticLayerFiles(state, this.company_name, this.functions))
      .addEdge(START, 'analyze_tables')
      .addEdge('analyze_tables', 'generate_recommendation_options')
      .addEdge('generate_recommendation_options', 'select_recommendations')
      .addEdge('select_recommendations', 'generate_cubejs_files')
      .addEdge('generate_cubejs_files', 'write_semantic_layer_files')
      .addEdge('write_semantic_layer_files', END);

    return subGraphBuilder.compile();
  }
}