import { authenticate, createCard, executeQuery, fetchFieldValues, getSchema, getExampleCards, deleteCard, createDashboard, getCards, getCard } from '../../utils/MetabaseAPI';
import { similaritySearch } from '../../utils/EmbeddingUtils';
import { HumanMessage } from '@langchain/core/messages';
import { GenerateMetabaseQueryTool, IdentifyFieldsTool, GetReasoningTool, GenerateInsightTool, AnalyzeFiltersTool, GetRelevantCardsTool} from '../../models/Tools';
import { getFasterModel, anthropicSonnet, createStructuredResponseAgent, getStrongestModel } from '../../models/Models';
import Logger from '../../utils/Logger';
import { fallbackCardExamples } from '../../utils/CardExamples';
import { NodeStatus } from '../../utils/StatusType';


export async function fetchSchema(company_name: string, database: number): Promise<{ sessionToken: string, schema: any, status: NodeStatus }> {
  const sessionToken = await authenticate(company_name);
  const schema = await getSchema(company_name, sessionToken, database);
  //Logger.log({schema}); //For development
  let status: NodeStatus;
  if (schema) {
    status = {type: 'data', data: {message: "Schema successfully retrieved", payload: { numTables: schema.length }}};
  } else {
    status = {type: 'error', error: {message: "Schema could not be retrieved"}}
  }

  return { sessionToken, schema, status };
}


export async function getFieldDetails(task: string, sessionToken: string, schema: any, companyName: string): Promise<{fieldDetails: Record<number, any>, isPossible: string, status: NodeStatus}> {
  const model = createStructuredResponseAgent(getStrongestModel(), [IdentifyFieldsTool]);

  const message = await model.invoke([
    new HumanMessage(`Given the task: "${task}"
      And the following schema: ${JSON.stringify(schema, null, 2)}

      1 - Identify if the query can be resolved without creating any new columns in my semantic layer
        Use the following criteria for determining difficulty:
        - "yes" if the calculation required is straightforward.
        - "maybe" if you are unsure if a new value should be created
        - "no" if it is not possible to calculate the necessary values with the current schema.

      2 - Identify which fields in the schema might need additional information such as distinct values or fingerprints to successfully create a Metabase query wihtout using custom columns or SQL.
          IE: 
          If the user request the current inventory levels and you only have the number of items purchased and the number of items sold you should create a new semantic layer value.
      `)
  ]);

  const requiredFieldIds: number[] = message.lc_kwargs.tool_calls[0].args.fieldIds;
  const isPossible: string = message.lc_kwargs.tool_calls[0].args.isPossible;
  Logger.log("Is possible:", isPossible)

  const fieldDetails: Record<number, any> = {};
  const fields = schema.map((i: any) => i.fields).flat(1);

  for (const fieldId of requiredFieldIds) {
    const details = fields.find((field: any) => field.id === fieldId);

    if (details) {
      const values = await fetchFieldValues(companyName, sessionToken, fieldId);
      const limitedValues = values.slice(0, 20);
      if (limitedValues) {
        fieldDetails[fieldId] = {
          ...details,
          values: limitedValues,
        };
      }
    }
  }

  let status: NodeStatus;
  if (requiredFieldIds.length) {
    status = {type: 'data', data: { message: "Appropriate fields identified for query", payload: { fieldDetails } }};
  } else {
    status = {type: 'error', error: { message: "No appropriate fields were found for this query" }}
  }

  return {fieldDetails, isPossible, status};
};

//TODO: Check this functionality
export async function createMetabaseCard(task: string, sessionToken: string, schema: any[], fieldDetails: Record<number, any>, databaseId: number,  companyName:string, feedbackMessage?: string, metabaseQuery?: any):
Promise<{ status: NodeStatus; cardId?: number; metabaseQuery: string }> {

  const filter = { databaseID: databaseId };
  //TODO: Check this functionality

  let exampleRelatedCards = "";
  if (!feedbackMessage) {
    const similaritySearchWithScoreResults = await similaritySearch(companyName, task, 3, filter);
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

    if (ids.length === 0) {
      Logger.log('No related cards found, using fallback cards');
      exampleRelatedCards = fallbackCardExamples(databaseId);
    } else {
      exampleRelatedCards = await getExampleCards(companyName, sessionToken, ids);
      //Logger.log('Recovered exampleRelatedCards', exampleRelatedCards);
    }
  } else {
    exampleRelatedCards = fallbackCardExamples(databaseId);
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

    Try to leverage the "CubeJoinField" fields that all tables have to join source tables.
    When available, try to use names instead of IDs for visualizations, even if a new join is necessary to get an item's name.
    For aggregations of type sum, use fields named starting with 'total' (eg totalAmount), if not available raise an error.
    For aggregations of type average, use fields named starting with 'average' (eg averageAmount), if not available raise an error.
           
    Here are some examples of a natural language query and its corresponding JSON representation (which used other tables you may not be able to use):

    ${feedbackMessage ? fallbackCardExamples : exampleRelatedCards}
  
    `)
  ]);
  
  const metabaseQueryResult = message.lc_kwargs.tool_calls[0].args;

  const cardIdResponse = await createCard(companyName, sessionToken, metabaseQueryResult); 

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
      status: {type: 'error', error: { message: errorMessage }},
      metabaseQuery: JSON.stringify(metabaseQueryResult)
    };
  } else {
    Logger.log('Card ID:', cardIdResponse); 
    return {
      status: {type: 'data', data: { message: `Metabase card created with ID ${cardIdResponse}`, payload: { cardId: cardIdResponse } }},
      cardId: cardIdResponse,
      metabaseQuery: JSON.stringify(metabaseQueryResult)
    };
  }
}

export async function executeMetabaseQuery(sessionToken: string, cardId: number, metabaseQuery: any, companyName:string):
 Promise<{ status: NodeStatus; queryResult?: any; metabaseQuery?: string }> {
  const queryResult = await executeQuery(companyName, sessionToken, cardId);

  if ("error" in queryResult) {
    Logger.log("Error executing query. Deleting card...");
    await deleteCard(companyName, sessionToken, cardId);
    
    let errorMessage = queryResult.error;
    
    if (errorMessage.includes("Can't detect Cube query")) {
      errorMessage = "The SQL created from your query is not supported by cubejs, please try to create the query in a different way";
    } else if (errorMessage.includes("Can't find join path")) {
      // errorMessage = "There is no JOIN between the sources. Please review your query.";
      // TODO: Improve error message
    }

    Logger.error(errorMessage);

    return {
      status: {type: 'error', error: { message: errorMessage }},
      metabaseQuery: metabaseQuery,
    };
  } else {
    Logger.log('Query executed successfully');
    return {
      status: {type: 'data', data: { message: "Query executed successfully", payload: { cardId } }},
      queryResult: queryResult
    };
  }
}

export async function getReasoning(queryResult: any, task: string, metabaseQuery: any, cardId: any, fieldDetails: any, schema: any): // TODO: fix types
Promise<{ finalResult: string; reasoning: string; sources: string[], status: NodeStatus }> {

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
  sources: sources,
  status: {type: 'data', data: { message: "Result insights and explanation prepared", payload: { cardId } }}
};
}

export async function identifyRelevantSources(task: string, sessionToken: string, databaseId: number, schema: any[], companyName:string): Promise<any[]> {
  const cards = await getCards(companyName, sessionToken, databaseId);


  const model = createStructuredResponseAgent(getFasterModel(), [GetRelevantCardsTool]);

  const message = await model.invoke([
    new HumanMessage(`
      Your task is to identify 3 or 4 relevant cards that could help resolve a given request. 
      To do this, you need to analyze the names, descriptions, and dataset queries of the available cards.

      The available cards are: ${JSON.stringify(cards)}
      The schema related to the dataset queries is: ${JSON.stringify(schema)}

      The request you need to consider is: ${task}

      Please analyze the dataset queries and schema to determine how the data is retrieved by each card and assess if it is relevant to the request.
    `),
  ]);

  const args = message.lc_kwargs.tool_calls[0].args;

  const relevantCardsIds = args.relevantCards;

  const relevantCards = relevantCardsIds.map((relevantCard: { id: number; }) => {
    const card = cards[relevantCard.id];
    return card ? { id: relevantCard.id, ...card } : null;
  }).filter((card: any) => card !== null);

  Logger.log('\rrelevantCards', relevantCards);

  return relevantCards;
}

export async function addFilters(task: string, sessionToken: string, databaseId: number, schema: any[], relevantCards:any[], companyName:string): Promise<any[]> {
  const model = createStructuredResponseAgent(anthropicSonnet(), [AnalyzeFiltersTool]);

  const message = await model.invoke([
    new HumanMessage(`
      You need to analyze the relevant cards to determine if they require filters to better meet the user's needs.
      The user's request is: ${task}
      
      Based on this request, analyze each relevant card to determine if it needs additional filters. 
      If filters are needed, suggest modifications to the dataset query, a new title, and a new description.

      The relevant cards are: ${JSON.stringify(relevantCards)}
      The schema related to the dataset queries is: ${JSON.stringify(schema)}
  
      Please analyze each card and suggest appropriate modifications if filters are necessary. 
      Ensure that the modifications align with the user's request, and provide a new title and description that reflect the changes made to the card.

      If no modifications are needed just return the id of the card and the value needsFilter = false

      Try to use only basic filters.
      This is an example of dataset_query using filters:

      {
        "database": ${databaseId},
        "type": "query",
        "query": {
          "source-table": 142,
          "aggregation": [
            [
              "sum",
              [
                "field",
                2024,
                {
                  "base-type": "type/Decimal"
                }
              ]
            ]
          ],
          "breakout": [
            [
              "field",
              2097,
              {
                "base-type": "type/Text",
                "join-alias": "Location - CubeJoinField"
              }
            ],
            [
              "field",
              2027,
              {
                "base-type": "type/DateTime",
                "temporal-unit": "month"
              }
            ]
          ],
          "joins": [
            {
              "fields": "all",
              "strategy": "left-join",
              "alias": "Location - CubeJoinField",
              "condition": [
                "=",
                [
                  "field",
                  2038,
                  {
                    "base-type": "type/Text"
                  }
                ],
                [
                  "field",
                  2099,
                  {
                    "base-type": "type/Text",
                    "join-alias": "Location - CubeJoinField"
                  }
                ]
              ],
              "source-table": 148
            }
          ],
          "order-by": [
            [
              "asc",
              [
                "aggregation",
                0
              ]
            ]
          ],
          "filter": [
            "and",
            [
              "not-empty",
              [
                "field",
                2097,
                {
                  "base-type": "type/Text",
                  "join-alias": "Location - CubeJoinField"
                }
              ]
            ],
            [
              "time-interval",
              [
                "field",
                2027,
                {
                  "base-type": "type/DateTime"
                }
              ],
              -12,
              "month"
            ]
          ]
        }
      }
    `),
  ]);
  

  const args = message.lc_kwargs.tool_calls[0].args;

  const cardModifications = args.cardModifications;
  Logger.log('\rCard Modifications', cardModifications);

  const updatedCards = [];

  for (const modifiedCard of cardModifications) {
    if (modifiedCard.needsFilter) {
      const cardDetails = await getCard(companyName, sessionToken, modifiedCard.id);

      const newCard = await createCard(companyName, sessionToken, {
        ...cardDetails,
        name: modifiedCard.newTitle,
        description: modifiedCard.newDescription,
        dataset_query: modifiedCard.modifiedDatasetQuery,
      });

      Logger.log("Card created:", newCard)

      updatedCards.push(newCard);
    } else {
      updatedCards.push(modifiedCard.id);
    }
  }

  return updatedCards
}

export async function getResults(task: string, sessionToken: string, databaseId: number, schema: any[], relevantCards:any[], companyName:string): Promise<any[]> {
  const insights = [];
  Logger.log("Relevant cards", relevantCards)
  for (const card of relevantCards) {
    const queryResult = await executeQuery(companyName, sessionToken, card);

    if (queryResult.error) {
      Logger.warn(`Error executing query for card ${card}: ${queryResult.error}`);
      continue;
    }

    const model = createStructuredResponseAgent(getFasterModel(), [GenerateInsightTool]);

    let resultString = JSON.stringify(queryResult);
    if (resultString.length > 5000) {
      resultString = resultString.substring(0, 5000) + '... (truncated to 5000 characters)';
    }

    const message = await model.invoke([
      new HumanMessage(`
        You have just executed a query for the card with ID ${card}. 
        The user's request was: ${task}

        The query result is: ${resultString}

        Based on this result, provide a concise explanation of the insight this data provides. 
        Your explanation should be informative and relevant to the user's request.
      `),
    ]);

    const args = message.lc_kwargs.tool_calls[0].args;

    insights.push({
      cardId: card,
      insightExplanation: args.insightExplanation,
    });
  }
 
  return insights
}