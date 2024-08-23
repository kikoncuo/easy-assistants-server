import { authenticate, getCards } from '../src/utils/MetabaseAPI';
import { addDocuments, deleteDocuments } from '../src/utils/EmbeddingUtils';
import dotenv from 'dotenv';

dotenv.config();

const METABASE_DB_ID = 2;
const START_CARD_ID = 1;
const END_CARD_ID = 100;

async function addCardsToVectorStore() {
  try {
    const sessionToken = await authenticate();
    const cards = await getCards(sessionToken, METABASE_DB_ID);

    const pageContents: string[] = [];
    const metadata: Record<string, any>[] = [];
    const pageIds: number[] = [];

    for (let cardId = START_CARD_ID; cardId <= END_CARD_ID; cardId++) {
      const card = cards[cardId];
      if (card) {
        pageContents.push(card.description || card.name);
        metadata.push({ cardId: card.id, databaseId: METABASE_DB_ID });
        pageIds.push(card.id);
      }
    }

    await addDocuments(pageContents, metadata, pageIds);
    console.log(`Added ${pageContents.length} cards to the vector store.`);
  } catch (error) {
    console.error('Error adding cards to vector store:', error);
  }
}

// Commented out function to remove documents
/*
async function removeCardsFromVectorStore() {
  try {
    const ids = Array.from({ length: END_CARD_ID - START_CARD_ID + 1 }, (_, i) => (START_CARD_ID + i).toString());
    await deleteDocuments(ids);
    console.log(`Removed ${ids.length} cards from the vector store.`);
  } catch (error) {
    console.error('Error removing cards from vector store:', error);
  }
}
*/

addCardsToVectorStore();
// Uncomment the following line when you want to remove the documents
// removeCardsFromVectorStore();