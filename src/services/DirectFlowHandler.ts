import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import Logger from '../utils/Logger';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { extractFunctionDetails } from './WorkflowHandler';

export function saveCsvTable(model: BaseChatModel, agentPrompt: string, toolFunction: Function, task: string) {
    const agent = getAgentNode(model, agentPrompt, toolFunction);
    return agent(task);
}

function getAgentNode(model: BaseChatModel, agentPrompt: string, toolFunction: Function) { // TODO: delete this, we are using subgraphs now
    async function agentNode(task: string): Promise<string> {
      try {
        const result = await model.invoke([new SystemMessage(agentPrompt), new HumanMessage(task)]);      
        const functions = extractFunctionDetails(result);
        const functionResult = await toolFunction('tool', functions);
        
        Logger.log(
          `Agent executed task ${task}, results: ${JSON.stringify(functionResult)}`,
        );
        return JSON.stringify(functionResult);
      } catch (error) {
        Logger.log('error in agent node', error)
        Logger.warn('Error in agent execution:', error);
        return 'Error in agent execution, please try again or contact support.';
      }
    }
    return agentNode;
  }