import { AbstractGraph, BaseState } from '../baseGraph';
import { authenticate, createCard, executeQuery, fetchFieldDetails, getSchema, getExampleCards, deleteCard, createDashboard } from '../../utils/MetabaseAPI';
import { similaritySearch, addDocuments } from '../../utils/EmbeddingUtils';
import { HumanMessage } from '@langchain/core/messages';
import { getFasterModel, anthropicSonnet, createStructuredResponseAgent } from '../../models/Models';
import { GenerateMetabaseQueryTool, IdentifyFieldsTool, GetReasoningTool} from '../../models/Tools';
import Logger from '../../utils/Logger';
import { fallbackCardExamples } from '../../utils/CardExamples';

// Minimum state to use the nodes

interface SchemaState extends BaseState {
  schema: any;
  sessionToken: string;
}

interface FieldState extends SchemaState {
  fieldDetails: Record<number, any>;
}

export interface QueryState extends FieldState {
  queryAttempts: number;
  feedbackMessage: string | null;
  metabaseQuery: any;
  cardId: number;
}

interface ResultState extends QueryState {
  cardId: number;
  queryResult: any;
  finalResult: string;
  stopExecution: boolean;
}


// Card Nodes

export async function fetchSchema(state: SchemaState, database: number): Promise<SchemaState> {
  const sessionToken = await authenticate();
  const schema = await getSchema(sessionToken, database);
  return {
    ...state,
    sessionToken,
    schema,
  };
}


export async function evaluateFieldRequirements(state: SchemaState): Promise<FieldState> {
  const model = createStructuredResponseAgent(getFasterModel(), [IdentifyFieldsTool]);

  const message = await model.invoke([
    new HumanMessage(`Given the task: "${state.task}", identify which fields in the schema might need additional information such as distinct values or fingerprints to successfully complete the query.
    The schema is as follows: ${JSON.stringify(state.schema, null, 2)}`)
  ]);
  const requiredFieldIds: number[] = message.lc_kwargs.tool_calls[0].args.fieldIds;

  const fieldDetails: Record<number, any> = {};

  for (const fieldId of requiredFieldIds) {
    const details = await fetchFieldDetails(state.sessionToken, fieldId);
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

  return {
    ...state,
    fieldDetails,
  };
};

export async function createMetabaseCard(state: QueryState, databaseId: number): Promise<QueryState> {

  const filter = { databaseID: databaseId };
  const similaritySearchWithScoreResults = await similaritySearch(state.task, 3, filter);
  Logger.log('Similarity search results', similaritySearchWithScoreResults);

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
    exampleRelatedCards = await getExampleCards(state.sessionToken, ids);
    Logger.log('Recovered exampleRelatedCards', exampleRelatedCards);
  }

  
  const model = createStructuredResponseAgent(anthropicSonnet(), [GenerateMetabaseQueryTool]); // Only model flexible enough to generate the query

  const queryAttempts =  (state.queryAttempts || 0) + 1;
  if (queryAttempts > 3) {
    Logger.log("Unable to generate a suitable query after 3 attempts.")
    return {
      ...state,
      queryAttempts, 
      finalResult: "Unable to generate a suitable query after 3 attempts. Here is the feedback message: " + state.feedbackMessage
    }
  }

  const message = await model.invoke([ // TODO: Move toolDefinition and prompt with more examples to a separate file, we should also make it way shorter giving examples of how to build queries instead of full queries
    new HumanMessage(`You are tasked with generating a Metabase query based on the following natural language task: 
    "${state.task}"

    The query must be interpretable by a business analyst, you should strive to make them easy to interpret and good looking.
  
    The schema of the database is:
    ${JSON.stringify(state.schema, null, 2)}
    You can only use the tables and fields that are provided in the schema.

    Here are some value examples for some of the fields of the schema:
    ${state.fieldDetails}
  
    Ensure that the query is well-formed, syntactically correct, and meets the requirements of the task.
    When applying filters, try to apply is not empty filters and prioritize contains filters over equals filters.
  
    ${state.feedbackMessage ? `Previous attempt has generated the following query ${state.metabaseQuery}, and resulted in an error: ${state.feedbackMessage}\n Please adjust the query or try a different approach to avoid this error` : ''}

    Try to leverage the "CubeJoinField" fields that all tables have to as source tables 
           
    Here are some examples of a natural language query and its corresponding JSON representation (which used other tables you may not be able to use):

    ${state.feedbackMessage ? fallbackCardExamples : exampleRelatedCards}
  
    `)
  ]);
  
  const metabaseQuery = message.lc_kwargs.tool_calls[0].args;

  const cardIdResponse = await createCard(state.sessionToken, metabaseQuery); 

  let feedbackMessage = '';
  if (typeof cardIdResponse === 'object' && ('error' in cardIdResponse)) {
    if (JSON.parse(cardIdResponse.error).message) {
      Logger.error(`Failed to create card: ${JSON.parse(cardIdResponse.error).message} (Status: ${cardIdResponse.status})`);
      feedbackMessage = JSON.parse(cardIdResponse.error).message;
    } else {
      Logger.error(`Failed to create card: ${JSON.stringify(cardIdResponse.error, null, 2)} (Status: ${cardIdResponse.status})`);
      feedbackMessage = "unknown error, try to create the query in a different way";
    }
    return {
      ...state,
      queryAttempts,
      feedbackMessage: feedbackMessage,
      metabaseQuery: JSON.stringify(metabaseQuery)
    };
  } else {
    Logger.log('Card ID:', cardIdResponse); 
    return {
      ...state,
      queryAttempts,
      cardId: cardIdResponse,
      metabaseQuery: JSON.stringify(metabaseQuery)
    };
  }
}

export async function executeMetabaseQuery(state: any): Promise<any> {
  let cardId = state.cardId;
  const query = JSON.parse(state.metabaseQuery);
  const queryResult = await executeQuery(state.sessionToken, state.cardId);
  let feedbackMessage = queryResult.error ?? "";
  if (("error" in queryResult)) {
    Logger.log("Error executing query. Deleting card...")
    await deleteCard(state.sessionToken, state.cardId);
    cardId = 0;
  }

  if (queryResult.error && queryResult.error.includes("Can't detect Cube query")) {
    Logger.error("We tried to execute a SQL query not supported by cubejs")
    feedbackMessage = "The SQL created from your query is not supported by cubejs, please try to create the query in a different way";
  }

  let stopExecution = false;
  let errorResult;
  if (queryResult.error && queryResult.error.includes("Can't find join path")) {
    Logger.error("There is no JOIN between the sources ")
    stopExecution = true;
    errorResult = queryResult.error;
  }

  Logger.log('Creating document:');

  return {
    ...state,
    feedbackMessage: feedbackMessage,
    queryResult,
    cardId, 
    stopExecution,
    finalResult: errorResult ? errorResult : JSON.stringify(queryResult, null, 2),
  };
}

export async function getReasoning(state: ResultState, functions: Function[]): Promise<ResultState> {

const model = createStructuredResponseAgent(getFasterModel(), [GetReasoningTool]); 

let resultString = '';

if (typeof state.queryResult === 'object') {
  resultString = JSON.stringify(state.queryResult);
}

let message;
if (state.queryResult.length === 0) {
  Logger.log('No results!');
  resultString = "The query has not returned values";
  message = await model.invoke([
    new HumanMessage(`You were asked to perform this task: ${state.task}
  
      This is the query created for the card: ${state.metabaseQuery?.dataset_query ? (state.metabaseQuery.dataset_query.query ?? state.metabaseQuery.dataset_query) : 'No query available'}, 
      
      This query does not return values. 
      
      The details of the relevant fields are: ${JSON.stringify(state.fieldDetails)}

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
    new HumanMessage(`You were asked to perform this task: ${state.task}
  
      This is the query created for the card: ${state.metabaseQuery.dataset_query ? (state.metabaseQuery.dataset_query.query ?? state.metabaseQuery.dataset_query) : state.metabaseQuery}, 
      due the following database schema: ${state.schema} 
      
      The results of execution of the card are: ${resultString})()
      }
      
      Explain how the task has been performed and give a reasoning on the fields and tables that have been used. The sources should be provided as an object where each table is represented with its name, and each table contains an array of the fields used. Note that the query result has been truncated to 5000 characters if it exceeded that length.`),
  ]);
}

const args = message.lc_kwargs.tool_calls[0].args;

const reasoning = args.reasoning;
const sources = args.sources;

const getDatasetQuery = [
  {
    function_name: 'getDatasetQuery',
    arguments: {
      cardId: state.cardId,
      reasoning,
      sources
    }
  },
];
functions[0]('tool', getDatasetQuery);

return {
  ...state,
  finalResult: resultString // we reassign here the truncated result
};
}