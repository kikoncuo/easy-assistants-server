// This is called in the server.ts file instead of a regular subgraph
import { AbstractGraph, BaseState } from './baseGraph';
import { createStructuredResponseAgent, anthropicSonnet } from '../models/Models';
import { CompiledStateGraph, END, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import Logger from '../utils/Logger';
import { getDataStructure } from '../utils/DataStructure';
import fs from 'fs';
import path from 'path';

interface SemanticLayerState extends BaseState {
  tableAnalysis: Record<string, TableAnalysis>;
  cubeJsFiles: Record<string, string>;
  finalResult: string;
}

interface TableAnalysis {
  missingValues: Record<string, number>;
  unusualValues: Record<string, any[]>;
  recommendations: string[];
}

async function analyzeTables(state: SemanticLayerState, prefixes: string, pgConnectionChain?: string): Promise<SemanticLayerState> {
  const dataStructure = await getDataStructure(prefixes, pgConnectionChain);
  const tables = dataStructure.split('\n\n').filter(table => table.startsWith('Table:'));

  const getAnalysis = z.object({
    tableAnalysis: z.record(z.string(), z.object({
      missingValues: z.record(z.string(), z.number()),
      unusualValues: z.record(z.string(), z.array(z.any())),
      recommendations: z.array(z.string())
    }))
  });

  const model = createStructuredResponseAgent(anthropicSonnet(), getAnalysis);

  const message = await model.invoke([
    new HumanMessage(`Analyze the following tables for missing or unusual values:
    ${tables.join('\n\n')}
    
    For each table, provide:
    1. A count of missing values for each column
    2. Any unusual or unexpected values for each column
    3. Recommendations for handling these issues in a semantic layer`)
  ]);

  const tableAnalysis = (message as any).tableAnalysis;
  Logger.log('Table analysis:', tableAnalysis);

  return {
    ...state,
    tableAnalysis
  };
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
  private pgConnectionChain: string | undefined;

  constructor(prefixes: string, pgConnectionChain?: string) {
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
    };
    super(graphState);
    this.prefixes = prefixes;
    this.pgConnectionChain = pgConnectionChain;
  }

  getGraph(): CompiledStateGraph<SemanticLayerState> {
    const subGraphBuilder = new StateGraph<SemanticLayerState>({ channels: this.channels });

    subGraphBuilder
      .addNode('analyze_tables', async state => await analyzeTables(state, this.prefixes, this.pgConnectionChain))
      .addNode('generate_cubejs_files', async state => await generateCubeJsFiles(state))
      .addNode('write_semantic_layer_files', async state => await writeSemanticLayerFiles(state))
      .addEdge(START, 'analyze_tables')
      .addEdge('analyze_tables', 'generate_cubejs_files')
      .addEdge('generate_cubejs_files', 'write_semantic_layer_files')
      .addEdge('write_semantic_layer_files', END);

    return subGraphBuilder.compile();
  }
}
