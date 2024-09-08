import { WebSocket } from 'ws';
import { GraphApplication } from '../services/GraphApplication';
import { WebSocketService } from '../services/WebSocketService';
//import { SemanticLayerGraph } from '../subgraphs/createSemanticLayer'; // Enable this when fixed
//import { EditCubeGraph } from '../subgraphs/editCubes';
import { addDocuments, deleteDocuments } from '../utils/EmbeddingUtils';
import Logger from '../utils/Logger';
import { getCodeInterpreterInstance, runCodeInterpret } from '../utils/codeInterpreter';

export class Router {
  private graphApps: Map<string, GraphApplication> = new Map();

  constructor(private ws: WebSocket) {}

  async handleMessage(message: string) {
    const data = JSON.parse(message);
    switch (data.type) {
      case 'query':
        await this.handleQuery(data);
        break;
      case 'configure':
        this.handleConfigure(data);
        break;
      /*case 'createSemanticLayer':
        await this.handleCreateSemanticLayer(data);
        break;*/
      /*case 'editSemanticLayer':
        await this.handleEditSemanticLayer(data);
        break;*/
      case 'runPythonCode':
        await this.handleRunPythonCode(data);
        break;
      case 'addDocuments':
        await this.handleAddDocuments(data);
        break;
      case 'deleteDocuments':
        await this.handleDeleteDocuments(data);
        break;
      case 'toolResponse':
        // this is handled by the graph application itself
        break;
      default:
        Logger.error(`Unknown message type: ${data.type}`);
    }
  }

  private async handleQuery(data: any) {
    Logger.log('Processing task:', data.task);
    const graphApp = this.graphApps.get(data.appType || 'default');
    if (graphApp) {
      await graphApp.processTask(data.task, data.thread_id);
    } else {
      Logger.error(`GraphApp not found for type: ${data.appType}`);
    }
  }

  private handleConfigure(data: any) {
    Logger.log('Configuring new graph application', data.appType || 'default');
    const graphApp = new GraphApplication(
      (type: string, message: string) => WebSocketService.outputHandler(type, message, this.ws),
      (type: string, functions: Array<{ function_name: string; arguments: any }>) =>
        WebSocketService.queryUser(type, functions, this.ws),
      data.configData,
      data.appType || 'default',
    );
    this.graphApps.set(data.appType || 'default', graphApp);
  }

  /*private async handleCreateSemanticLayer(data: any) {
    Logger.log('Creating semantic layer');
    const semanticLayerGraph = new SemanticLayerGraph(data.prefixes, data.pgConnectionString, data.company_name);
    const result = await semanticLayerGraph
      .getGraph()
      .invoke({ task: "Create a semantic layer for the company's data" });
    WebSocketService.outputHandler('semanticLayer', result.finalResult, this.ws);
  }*/

  /*private async handleEditSemanticLayer(data: any) {
    Logger.log('Started process for editing semantic layer');
    const editCubeGraph = new EditCubeGraph(data.company_name, [
      (type: string, message: string) => WebSocketService.outputHandler(type, message, this.ws),
    ]);
    const result = await editCubeGraph.getGraph().invoke({
      task: data.task,
    });
    WebSocketService.outputHandler('semanticLayer', result.finalResult, this.ws);
  }*/

  private async handleAddDocuments(data: any) {
    try {
      Logger.log('Adding documents');
      const { company_name, pageContents, metadata, docId } = data.data;
      const result = await addDocuments(company_name, pageContents, metadata, docId);
      WebSocketService.outputHandler('addDocuments', 'Documents added successfully', this.ws);
    } catch (error) {
      Logger.error('Error adding documents:', error);
      WebSocketService.outputHandler('addDocuments', 'Error adding documents', this.ws);
    }
  }

  private async handleDeleteDocuments(data: any) {
    try {
      Logger.log('Deleting documents');
      const { company_name, ids } = data.data;
      await deleteDocuments(company_name, ids);
      WebSocketService.outputHandler('deleteDocuments', 'Documents deleted successfully', this.ws);
    } catch (error) {
      Logger.error('Error deleting documents:', error);
      WebSocketService.outputHandler('deleteDocuments', 'Error deleting documents', this.ws);
    }
  }

  private async handleRunPythonCode(data: any) {
    const code = data.data;
    Logger.log('code', code)
  
    const codeInterpreter = await getCodeInterpreterInstance();
  
    const outputHandler = (type: string, functions: any) => {
      
      WebSocketService.queryUser(type, functions, this.ws);
    };
  
    try {
      const exec = await runCodeInterpret(codeInterpreter, code, [outputHandler]);
      
      if (!exec) {
        throw new Error("Failed to execute Python code");
      }
  
      let results = [];
      for (let result of exec.results) {
        if (result.png) {
          results.push({
            type: 'image',
            data: result.png,
            description: result.text
          });
        } else {
          results.push({
            type: 'text',
            data: result.text
          });
        }
      }
  
      // outputHandler('tool', {
      //   logs: exec.logs,
      //   results: results
      // });
      const getPythonCodeResult = [
        {
            function_name: 'pythonCodeResult',
            arguments: {
              logs: exec.logs,
              results: results
            }
        }
    ]
    outputHandler('tool', getPythonCodeResult);
    } catch (error) {
      Logger.error('Error running Python code:', error);
      outputHandler('tool', error);
    } finally {
      await codeInterpreter.close();
    }
  }
}