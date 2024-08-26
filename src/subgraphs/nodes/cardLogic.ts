import { authenticate, createCard, executeQuery, fetchFieldDetails, getSchema, getExampleCards, deleteCard, createDashboard } from '../../utils/MetabaseAPI';
import { similaritySearch } from '../../utils/EmbeddingUtils';
import { HumanMessage } from '@langchain/core/messages';
import { getFasterModel, anthropicSonnet, createStructuredResponseAgent } from '../../models/Models';
import { GenerateMetabaseQueryTool, IdentifyFieldsTool, GetReasoningTool} from '../../models/Tools';
import Logger from '../../utils/Logger';
import { fallbackCardExamples } from '../../utils/CardExamples';


export async function fetchSchema(database: number): Promise<{ sessionToken: string, schema: any }> {
  const sessionToken = await authenticate();
  const schema = await getSchema(sessionToken, database);
  return { sessionToken, schema };

}


export async function getFieldDetails(task: string, sessionToken: string, schema: any): Promise<Record<number, any>> {
  const model = createStructuredResponseAgent(getFasterModel(), [IdentifyFieldsTool]);

  const message = await model.invoke([
    new HumanMessage(`Given the task: "${task}", identify which fields in the schema might need additional information such as distinct values or fingerprints to successfully complete the query.
    The schema is as follows: ${JSON.stringify(schema, null, 2)}`)
  ]);
  const requiredFieldIds: number[] = message.lc_kwargs.tool_calls[0].args.fieldIds;

  const fieldDetails: Record<number, any> = {};

  for (const fieldId of requiredFieldIds) {
    const details = await fetchFieldDetails(sessionToken, fieldId);
    if (details) {
      const limitedValues = details.values.slice(0, 20);
      if (limitedValues) {
        fieldDetails[fieldId] = {
          ...details,
          values: limitedValues,
        };
      }
    }
  }

  return fieldDetails;
};

export async function createMetabaseCard(task: string, sessionToken: string, schema: any[], fieldDetails: Record<number, any>, databaseId: number, feedbackMessage?: string, metabaseQuery?: any):
Promise<{ cardId: number; metabaseQuery: string } | { error: string; metabaseQuery: string }> {

  const filter = { databaseID: databaseId };
  const similaritySearchWithScoreResults = await similaritySearch(task, 3, filter);
  //Logger.log('Similarity search results', similaritySearchWithScoreResults);

  let ids = [];

  for (const [doc, score] of similaritySearchWithScoreResults) {
    Logger.log(
      `* [SIM=${score.toFixed(3)}] ${doc.pageContent} [${JSON.stringify(
        doc.metadata
      )}]`
    );
    ids.push(doc.metadata.id);
  }

  let exampleRelatedCards = ""

  if (ids.length === 0) {
    Logger.log('No related cards found using fallback cards');
    exampleRelatedCards = fallbackCardExamples(databaseId);
  } else {
    exampleRelatedCards = await getExampleCards(sessionToken, ids);
    //Logger.log('Recovered exampleRelatedCards', exampleRelatedCards);
  }

  
  const model = createStructuredResponseAgent(anthropicSonnet(), [GenerateMetabaseQueryTool]); // Only model flexible enough to generate the query

  const message = await model.invoke([ 
    new HumanMessage(`You are tasked with generating a Metabase query based on the following natural language task: 
    "${task}"

    The query must be interpretable by a business analyst, you should strive to make them easy to interpret and good looking.
  
    The schema of the database is:
    ${JSON.stringify(schema, null, 2)}
    You can only use the tables and fields that are provided in the schema.

    Here are some value examples for some of the fields of the schema:
    ${fieldDetails}
  
    Ensure that the query is well-formed, syntactically correct, and meets the requirements of the task.
    When applying filters, try to apply is not empty filters and prioritize contains filters over equals filters.
  
    ${feedbackMessage ? `Previous attempt has generated the following query ${metabaseQuery}, and resulted in an error: ${feedbackMessage}\n Please adjust the query or try a different approach to avoid this error` : ''}

    Try to leverage the "CubeJoinField" fields that all tables have to as source tables 
           
    Here are some examples of a natural language query and its corresponding JSON representation (which used other tables you may not be able to use):

    ${feedbackMessage ? fallbackCardExamples : exampleRelatedCards}
  
    `)
  ]);
  
  const metabaseQueryResult = message.lc_kwargs.tool_calls[0].args;

  const cardIdResponse = await createCard(sessionToken, metabaseQueryResult); 

  if (typeof cardIdResponse === 'object' && ('error' in cardIdResponse)) {
    let errorMessage = "";
    if (JSON.parse(cardIdResponse.error).message) {
      Logger.error(`Failed to create card: ${JSON.parse(cardIdResponse.error).message} (Status: ${cardIdResponse.status})`);
      errorMessage = JSON.parse(cardIdResponse.error).message;
    } else {
      Logger.error(`Failed to create card: ${JSON.stringify(cardIdResponse.error, null, 2)} (Status: ${cardIdResponse.status})`);
      errorMessage = "unknown error, try to create the query in a different way";
    }
    return {
      error: errorMessage,
      metabaseQuery: JSON.stringify(metabaseQueryResult)
    };
  } else {
    Logger.log('Card ID:', cardIdResponse); 
    return {
      cardId: cardIdResponse,
      metabaseQuery: JSON.stringify(metabaseQueryResult)
    };
  }
}

export async function executeMetabaseQuery(sessionToken: string, cardId: number, metabaseQuery: any):
 Promise<{ queryResult: any } | { error: string; metabaseQuery: string}> {
  const queryResult = await executeQuery(sessionToken, cardId);

  if ("error" in queryResult) {
    Logger.log("Error executing query. Deleting card...");
    await deleteCard(sessionToken, cardId);
    
    let errorMessage = queryResult.error;
    
    if (errorMessage.includes("Can't detect Cube query")) {
      errorMessage = "The SQL created from your query is not supported by cubejs, please try to create the query in a different way";
    } else if (errorMessage.includes("Can't find join path")) {
      errorMessage = "There is no JOIN between the sources. Please revise your query.";
    }

    Logger.error(errorMessage);

    return {
      error: errorMessage,
      metabaseQuery: metabaseQuery,
    };
  } else {
    Logger.log('Query executed successfully');
    return {
      queryResult: queryResult
    };
  }
}

export async function getReasoning(queryResult: any, task: string, metabaseQuery: any, cardId: any, fieldDetails: any, schema: any): // TODO: fix types
Promise<{ finalResult: string; reasoning: string; sources: string[] }> {

const model = createStructuredResponseAgent(getFasterModel(), [GetReasoningTool]); 

let resultString = '';

if (typeof queryResult === 'object') {
  resultString = JSON.stringify(queryResult);
}

let message;
if (queryResult.length === 0) {
  Logger.log('No results!');
  resultString = "The query has not returned values";
  message = await model.invoke([
    new HumanMessage(`You were asked to perform this task: ${task}
  
      This is the query created for the card: ${metabaseQuery?.dataset_query ? (metabaseQuery.dataset_query.query ?? metabaseQuery.dataset_query) : 'No query available'}, 
      
      This query does not return values. 
      
      The details of the relevant fields are: ${JSON.stringify(fieldDetails)}

      Analyze details of the relevant fields to explain why there is no data. 
      Reference the contents of those fields. 
      
      IE: There are no results because the field 'Date' has data ranging from 2024-01-11 to 2024-08-13. 

      The current date is ${new Date()}
    `),
  ]);
} else {
  if (resultString.length > 5000) {
    resultString = resultString.substring(0, 5000) + '... (truncated to 5000 characters)';
  }

  Logger.log('Query result:', resultString);

  message = await model.invoke([
    new HumanMessage(`You were asked to perform this task: ${task}
  
      This is the query created for the card: ${metabaseQuery.dataset_query ? (metabaseQuery.dataset_query.query ?? metabaseQuery.dataset_query) : metabaseQuery}, 
      due the following database schema: ${schema} 
      
      The results of execution of the card are: ${resultString})()
      }
      
      Explain how the task has been performed and give a reasoning on the fields and tables that have been used. The sources should be provided as an object where each table is represented with its name, and each table contains an array of the fields used. Note that the query result has been truncated to 5000 characters if it exceeded that length.`),
  ]);
}

const args = message.lc_kwargs.tool_calls[0].args;

const reasoning = args.reasoning;
const sources = args.sources;

return {
  finalResult: resultString, // we reassign here the truncated result
  reasoning: reasoning,
  sources: sources
};
}