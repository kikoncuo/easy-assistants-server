import { HumanMessage } from '@langchain/core/messages';
import { anthropicSonnet, createStructuredResponseAgent } from '../../models/Models';
import { GetSourcesTool } from '../../models/Tools';
import Logger from '../../utils/Logger';
import { EditCubeGraph } from '../editCubes';
import { getSchema, syncDatabaseSchema } from '../../utils/MetabaseAPI';
import { getModelsData } from '../../utils/DataStructure';
import { NodeStatus, createNodeResponse } from '../../utils/NodeResponseUtils';

export async function checkUpdateSemanticLayer(
  task: string,
  company_name: string,
): Promise<{ needsSemanticUpdate: boolean; semanticTask: string }> {
  const cubeModels = await getModelsData(company_name);

  const model = createStructuredResponseAgent(anthropicSonnet(), [GetSourcesTool]);

  const message = await model.invoke([
    new HumanMessage(`You are tasked with identifying relevant data sources for a given request. Your goal is to analyze the provided model descriptions and examples,
          and determine if a new measure or dimension has to be created on the semantic layer.
  
          First, review the following CubeJS model descriptions to know the curent dimensions and measures available:
          ${cubeModels.join('\n')}
          Now, consider the following request:
          ${task}
          
          I you think a new value in the semantic layer is 100% required for this task, because it can't be calculated with the existing data, specify what measure or dimension should be created on the semantic layer.
          As example, if the user request the top 5 products and we don't have a definition for 'topProducts' or it cannot be calculated using existing measures, dimensions and filters, ask to create it.
          `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const needsSemanticUpdate = args.needsSemanticUpdate;
  const semanticTask = args.semanticTask || '';

  Logger.log('\nneedsSemanticUpdate', needsSemanticUpdate);
  Logger.log('\nsemanticTask', semanticTask);

  //If needsSemanticUpdate we will interact with the user to await if he want to proceed with the update or not. If not, we will put the state needsSemanticUpdate false to continue the normal procedure.

  return {
    needsSemanticUpdate: needsSemanticUpdate,
    semanticTask: needsSemanticUpdate ? semanticTask.map((item: any) => item.value).join(', ') : '',
  };
}

export async function handleEditCubeGraph(
  semanticTask: string,
  sessionToken: string,
  functions: Function[],
  databaseId: number,
  company_name: string,
): Promise<{ schema: any[]; result: string }> {
  const editCubeGraph = new EditCubeGraph(company_name, sessionToken, databaseId, functions);
  const result = await editCubeGraph.getGraph().invoke({
    task: semanticTask,
  });
  const schema = await getSchema(company_name, sessionToken, databaseId);

  Logger.log(`Edit cube graph result: ${result.finalResult}`);
  //TODO: Inform frontend user that the result is OK.

  return {
    schema,
    result,
  };
}
