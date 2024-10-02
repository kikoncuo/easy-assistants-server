import { HumanMessage } from "@langchain/core/messages";
import { anthropicSonnet, createStructuredResponseAgent, getFasterModel } from "../../models/Models";
import { GetSourcesTool, GetSuggestionsForAskedQuestionTool, GetSuggestionsTool } from "../../models/Tools";
import Logger from "../../utils/Logger";
// import { EditCubeGraph } from "../editCubes";
import { getSchema } from "../../utils/MetabaseAPI";
import { getModelsData } from "../../utils/DataStructure";

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
    semanticTask: needsSemanticUpdate ? semanticTask : ''
  };

}

// export async function handleEditCubeGraph(semanticTask: string, sessionToken: string, functions: Function[], databaseId: number, company_name: string): Promise<{ schema: any[], result: string }> {
//   const editCubeGraph = new EditCubeGraph(company_name, sessionToken, databaseId, functions);
//   const result = await editCubeGraph.getGraph().invoke({
//     task: semanticTask,
//   });
//   const schema = await getSchema(company_name, sessionToken, databaseId);

//   Logger.log(`Edit cube graph result: ${result.finalResult}`);
//   //TODO: Inform frontend user that the result is OK.

//   return {
//     schema,
//     result
//   };
// }


export async function getSuggestions(
  schema: any[],
): Promise<{ getDataSuggestions: string[]; insightsSuggestions: string[] }> {

  const model = createStructuredResponseAgent(getFasterModel(), [GetSuggestionsTool]);

  // Mejorar el prompt con más contexto y claridad
  const message = await model.invoke([
    new HumanMessage(`
      You are an AI tasked with generating suggestions for questions or prompts that users can ask about the following data schema:
      ${JSON.stringify(schema)}.
      
      The data schema represents tables and fields related to various business or data contexts. Your job is to:
      
      1. Identify only four possible data-related prompts (getDataSuggestions) that would help users retrieve relevant information from this schema.
         Examples might include querying sales, product information, or performance metrics.
      
      2. Identify only four insight-related prompts (insightsSuggestions) that would help users derive meaningful insights from the data, such as trends, anomalies, or patterns.

      Provide your suggestions in two arrays: 'getDataSuggestions' for direct data queries and 'insightsSuggestions' for deeper analysis or insights.
    `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const getDataSuggestions = args.getDataSuggestions;
  const insightsSuggestions = args.insightsSuggestions;

  Logger.log('\getDataSuggestions', getDataSuggestions.join(','));
  Logger.log('\insightsSuggestions', insightsSuggestions.join(','));

  return {
    getDataSuggestions,
    insightsSuggestions
  };
}

export async function getSuggestionForAskedQuestion(
  schema: any[],
  task: string
): Promise<{ suggestion: string}> {

  const model = createStructuredResponseAgent(getFasterModel(), [GetSuggestionsForAskedQuestionTool]);
  const message = await model.invoke([
    new HumanMessage(`
      You are an AI assistant that receives both a user question (referred to as 'task') and a data schema ('schema'). Sometimes, when you are unable to fulfill the user's request due to missing or inaccessible data, your job is to generate an alternative query suggestion based on the task and schema.
  
      Your responsibilities are:
  
      1. Analyze the provided schema: ${JSON.stringify(schema)}. The schema represents tables and fields related to various business or data contexts (such as sales, product information, or performance metrics).
     
      2. Based on the user’s task  ${task}  (question) and schema, suggest one alternative query in the form of a string (suggestion) that could retrieve relevant information, even if the original query cannot be executed. The alternative query must return data that can always be represented either as a chart or a table. For example, if the user is asking for detailed sales data that isn't available, suggest querying general sales trends or related metrics instead.
  
      Return the alternative query in a string format: "suggestion: [your query suggestion here]".
  
      Ensure that the suggestion can be represented in a chart or table.
    `),
  ]);
  
  const args = message.lc_kwargs.tool_calls[0].args;

  const suggestion = args.suggestion;

  return {
    suggestion
  };
}

