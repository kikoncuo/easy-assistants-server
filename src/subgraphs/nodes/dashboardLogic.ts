/*import { createDashboard } from '../../utils/MetabaseAPI';
import { addDocuments } from '../../utils/EmbeddingUtils';
import { HumanMessage } from '@langchain/core/messages';
import { getFasterModel, createStructuredResponseAgent } from '../../models/Models';
import { GenerateCardDescriptionsTool, GenerateDashboardLayoutTool } from '../../models/Tools';
import Logger from '../../utils/Logger';
import { createMetabaseCard } from './cardLogic';

export async function createCardDescriptions(
  task: string,
  fieldDetails: Record<number, any>,
  schema: any[]
): Promise<string[]> {
  const model = createStructuredResponseAgent(getFasterModel(), [GenerateCardDescriptionsTool]);

  const message = await model.invoke([
    new HumanMessage(`Create descriptions for insightful cards to be included in a dashboard based on the task: "${task}". 
    Use the following field details: ${JSON.stringify(fieldDetails, null, 2)}
    
    The schema of the database is:
    ${JSON.stringify(schema, null, 2)}

    Ensure that the cards provide a comprehensive view of the data and address the main points of the task. 
    Include a mix of visualization types that best represent the data and insights.
    Make sure to only use tables and fields that are available in the provided schema.
    Try to combine tables when possible to create more useful cards IE: combine labor with orders or locations to create more insightful cards.`)
  ]);

  const cardDescriptions = message.lc_kwargs.tool_calls[0].args.cardDescriptions;
  
  // Convert the array of objects to an array of strings
  const stringDescriptions = cardDescriptions.map((card: any) => JSON.stringify(card));

  return stringDescriptions;
}

export async function createMultipleCardsAndSaveEmbeddings(
  cardDescriptions: string[],
  sessionToken: string,
  schema: any[],
  fieldDetails: Record<number, any>,
  databaseId: number
): Promise<{ createdCards: any[], error?: string }> {
  const cardPromises = cardDescriptions.map(description => 
    createMetabaseCard(description, sessionToken, schema, fieldDetails, databaseId)
  );

  const results = await Promise.all(cardPromises);

  const pageContents: string[] = [];
  const metadata: any[] = [];
  const pageIds: number[] = [];
  const createdCards: any[] = [];

  results.forEach((result, index) => {
    if ('cardId' in result) {
      const cardObject = {
        id: result.cardId,
        title: cardDescriptions[index],
        description: cardDescriptions[index],
      };
      createdCards.push(cardObject);

      pageContents.push(`${cardObject.title}\n${cardObject.description}`);
      metadata.push({
        id: result.cardId,
        type: 'card',
        databaseID: databaseId
      });
      pageIds.push(result.cardId);
    } else {
      Logger.error(`Failed to create card: ${result.error}`);
    }
  });

  if (pageContents.length > 0) {
    try {
      await addDocuments(pageContents, metadata, pageIds);
      Logger.log('Embeddings saved successfully');
    } catch (error) {
      Logger.error('Error saving embeddings:', error);
      return { createdCards, error: 'Failed to save embeddings' };
    }
  }

  return { createdCards };
}

export async function createMetabaseDashboard(
  task: string,
  sessionToken: string,
  createdCards: any[]
): Promise<{ dashboardId: number, finalDashboard: any } | { error: string }> {
  const model = createStructuredResponseAgent(getFasterModel(), [GenerateDashboardLayoutTool]);

  const message = await model.invoke([
    new HumanMessage(`Create a dashboard layout for the following task: "${task}".
    Use the following cards:
    ${JSON.stringify(createdCards, null, 2)}
    
    Create a layout that best represents the data and insights from these cards.
    Organize the cards in a logical manner, considering their content and relevance to the task.
    Create appropriate tabs if needed to group related cards.
    Add relevant parameters that could be useful for filtering the dashboard.
    
    Make sure to include all required fields for each object, including ids for dashcards, tabs, and parameters.`)
  ]);

  const dashboardLayout = message.lc_kwargs.tool_calls[0].args.dashboardLayout;

  // Prepare the dashboard data
  const dashboardData = {
    name: dashboardLayout.name,
    description: dashboardLayout.description,
  };

  // Prepare the dashboard content
  const dashboardContent = {
      description: dashboardLayout.description,
      name: dashboardLayout.name,
      dashcards: dashboardLayout.dashcards.map((card: any) => ({
        ...card,
        visualization_settings: {},
        series: []
      })),
      tabs: dashboardLayout.tabs,
      parameters: dashboardLayout.parameters,
      archived: false,
      collection_position: null,
      enable_embedding: false,
      collection_id: null,
      show_in_getting_started: false,
      caveats: null,
      embedding_params: null,
      cache_ttl: null,
      position: null,
      points_of_interest: null
  };

  try {
    const dashboardId = await createDashboard(sessionToken, dashboardData, dashboardContent);

    if (typeof dashboardId === 'number') {
      Logger.log('Dashboard created with ID:', dashboardId);

      return {
        dashboardId: dashboardId,
        finalDashboard: {
          id: dashboardId,
          ...dashboardLayout,
        }
      };
    } else {
      Logger.error('Error creating dashboard:', dashboardId.error);
      return { error: 'Failed to create dashboard' };
    }
  } catch (error) {
    Logger.error('Error during dashboard creation:', error);
    return { error: 'Error during dashboard creation' };
  }
}*/