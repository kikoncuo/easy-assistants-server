
import { createToolsAgent, getFasterModel, getStrongestModel } from "../../models/Models";
import { CodeFinishedTool, GenerateCodeTool, GeneratePlanTool, GenerateReportTool, IdentifyingTablesDoneTool, PlanFinishedTool, ReportFinishedTool, TableIdentifyingTool } from "../../models/Tools";
import { InsightDatasetStateV3 } from "../getInisghtsV3";
import { LLMResponseHandler, ToolHandlerType } from "../../utils/LLMResponseHandler";
import axios from "axios";
import { ConfigurationManager } from "../../utils/ConfigurationManager";
import Logger from "../../utils/Logger";

export async function getRelevantTables(state: InsightDatasetStateV3, llmResponseHandler: LLMResponseHandler): Promise<{ state: Partial<InsightDatasetStateV3>, response: Partial<any> }> {
  const model = createToolsAgent(getFasterModel(), [TableIdentifyingTool, IdentifyingTablesDoneTool]);
  let { messages } = state;
  const response = await llmResponseHandler.processResponse(
    { ...state, messages },
    model
  );
  const updatedState = { ...state };
  return { state: updatedState, response };
};

export async function getPlan(state: InsightDatasetStateV3, llmResponseHandler: LLMResponseHandler, toolHandlers?: { [toolName: string]: ToolHandlerType }): Promise<{ state: Partial<InsightDatasetStateV3>, response: Partial<any> }> {
  const model = createToolsAgent(getFasterModel(), [GeneratePlanTool, PlanFinishedTool]);
  let { messages } = state;
  const response = await llmResponseHandler.processResponse(
    { ...state, messages },
    model,
    toolHandlers
  );
  const updatedState = { ...state };
  return { state: updatedState, response };
}

export async function getCode(state: InsightDatasetStateV3, llmResponseHandler: LLMResponseHandler, toolHandlers?: { [toolName: string]: ToolHandlerType }): Promise<{ state: Partial<InsightDatasetStateV3>, response: Partial<any> }> {
  const model = createToolsAgent(getFasterModel(), [GenerateCodeTool, CodeFinishedTool]);
  let { messages } = state;
  const response = await llmResponseHandler.processResponse(
    { ...state, messages },
    model,
    toolHandlers
  );
  const updatedState = { ...state };
  return { state: updatedState, response };
}

export async function getReport(state: any, llmResponseHandler: LLMResponseHandler) {
  const model = createToolsAgent(getFasterModel(), [GenerateReportTool, ReportFinishedTool]);
  let { messages } = state;
  const response = await llmResponseHandler.processResponse(
    { ...state, messages },
    model
  );
  const updatedState = { ...state };
  return { state: updatedState, response };
}

export async function startKernel(state: InsightDatasetStateV3, companyName: string, sessionToken: string, database: number) {
  const startResponse = await axios.post('http://localhost:8000/start');
        const kernelId = startResponse.data.kernel_id;
        for(let i = 0; i < state.relevantTables.length; i++) {
        const table = state.relevantTables[i];
        const tableName = table.name.toLowerCase()
        const config = ConfigurationManager.getConfig(companyName);
        const url = `${config.METABASE_URL}/dataset/csv?format_rows=true`
        const Dataset = `
import requests
from urllib.parse import urlencode
import json

def getDatasetAsCSV():
    
    try:
        ${tableName} = None
        payload = {
            'query': json.dumps({
                'database': ${database},
                'query': { 'source-table': ${table.id}, 'limit': 10000 },
                'type': 'query'
            })
        }
        url = '${url}'
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Metabase-Session': '${sessionToken}'
        }
        response = requests.post(url, data=urlencode(payload), headers=headers)
        if response.status_code == 200:
            if response.text:
                print(response.text)
                ${tableName} = response.text
            return ${tableName}
        else:
            print(f"Error: {response.status_code}")
            return None
    except Exception as e:
        print(f"Error authenticating: {str(e)}")

${tableName} = getDatasetAsCSV()
        `;
  
        const addCellResponse = await axios.post('http://localhost:8000/cell', {
            kernel_id: kernelId,
            cell_number: i+1, 
            code: Dataset, 
            action: 'add'
        });
  
        console.log("addCellResponse.data",addCellResponse.data); 
          const runCellResponse = await axios.post('http://localhost:8000/cell', {
              kernel_id: kernelId,
              cell_number: i+1, 
              action: 'run'
          });
          Logger.log('runCellResponse.data', runCellResponse.data);

      }
      return kernelId;
}