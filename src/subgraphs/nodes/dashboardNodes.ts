import { AbstractGraph, BaseState } from '../baseGraph';
import { getExampleCards, deleteCard, createDashboard } from '../../utils/MetabaseAPI';
import { similaritySearch, addDocuments } from '../../utils/EmbeddingUtils';
import { HumanMessage } from '@langchain/core/messages';
import { getFasterModel, anthropicSonnet, createStructuredResponseAgent } from '../../models/Models';
import { GenerateCardDescriptionsTool, } from '../../models/Tools';
import Logger from '../../utils/Logger';
import { fallbackCardExamples } from '../../utils/CardExamples';
import { createMetabaseCard, QueryState } from './cardNodes';


// Minimum state to use the nodes

interface CardDescriptionsState extends BaseState {
  fieldDetails: Record<number, any>;
  cardDescriptions: string[];
}

interface MultipleCardCreationState extends CardDescriptionsState {
  cardDescriptions: string[];
  databaseId: number;
  createdCards: any[];
  sessionToken: string;
  schema: any[];
}

interface DashboardCreationState extends MultipleCardCreationState {
  sessionToken: string;
  dashboardId: number;
  finalDashboard: any;
}


// Dashboard Nodes

export async function createCardDescriptions(state: CardDescriptionsState, databaseId: number): Promise<CardDescriptionsState> {

  const model = createStructuredResponseAgent(getFasterModel(), [GenerateCardDescriptionsTool]);

  const message = await model.invoke([
    new HumanMessage(`Create descriptions for 3-5 insightful cards to be included in a dashboard based on the task: "${state.task}". 
    Use the following field details: ${JSON.stringify(state.fieldDetails, null, 2)}
    
    
    Ensure that the cards provide a comprehensive view of the data and address the main points of the task. 
    Include a mix of visualization types that best represent the data and insights.`)
  ]);

  const cardDescriptions = message.lc_kwargs.tool_calls[0].args.cardDescriptions;

  return {
    ...state,
    cardDescriptions,
  };
}

export async function createMultipleCardsAndSaveEmbeddings(state: MultipleCardCreationState): Promise<MultipleCardCreationState> {
  const cardPromises = state.cardDescriptions.map(description => 
    createMetabaseCard({
      task: description,
      sessionToken: state.sessionToken,
      schema: state.schema,
      fieldDetails: state.fieldDetails,
      queryAttempts: 0,
      feedbackMessage: null,
      metabaseQuery: null,
      cardId: 0
    } as QueryState, state.databaseId)
  );

  const results = await Promise.all(cardPromises);

  const pageContents: string[] = [];
  const metadata: any[] = [];
  const pageIds: number[] = [];
  const createdCards: any[] = [];

  // Adds cards to array to be saved in state and create card documents to be saved in vector store

  results.forEach((result, index) => {
    if (result.cardId) {
      const cardObject = {
        id: result.cardId,
        title: state.cardDescriptions[index],
        description: state.cardDescriptions[index],
      };
      createdCards.push(cardObject);

      pageContents.push(`${cardObject.title}\n${cardObject.description}`);
      metadata.push({
        id: result.cardId,
        type: 'card',
        databaseID: state.databaseId
      });
      pageIds.push(result.cardId);
    }
  });

  if (pageContents.length > 0) {
    try {
      await addDocuments(pageContents, metadata, pageIds);
      Logger.log('Embeddings saved successfully');
    } catch (error) {
      Logger.error('Error saving embeddings:', error);
    }
  }

  return {
    ...state,
    createdCards,
  };
}



export async function createMetabaseDashboard(state: DashboardCreationState): Promise<DashboardCreationState> {
  const dashboardData = {
    name: state.task,
    description: `Dashboard for: ${state.task}`,
  };

  const cards = state.createdCards.map(card => ({
    card_id: card.id,
    col: 0,
    row: 0,
    sizeX: 2,
    sizeY: 2,
  }));

  const dashboardContent = {
    cards: cards,
  };

  try {
    const dashboardId = await createDashboard(state.sessionToken, dashboardData, dashboardContent);

    if (typeof dashboardId === 'number') {
      Logger.log('Dashboard created with ID:', dashboardId);

      return {
        ...state,
        dashboardId: dashboardId,
        finalDashboard: {
          id: dashboardId,
          cards: state.createdCards,
        }
      };
    } else {
      Logger.error('Error creating dashboard:', dashboardId.error);
      return state;
    }
  } catch (error) {
    Logger.error('Error during dashboard creation:', error);
    return state;
  }
}