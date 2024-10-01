import { OpenAIEmbeddings } from "@langchain/openai";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { createClient } from "@supabase/supabase-js";
import type { Document } from "@langchain/core/documents";
import { ConfigurationManager } from './ConfigurationManager';

export function initializeSupabaseClient(clientName: string) {
  const config = ConfigurationManager.getConfig(clientName);

  return createClient(
    config.SUPABASE_URL,
    config.SUPABASE_PRIVATE_KEY
  );
}

export function initializeVectorStore(clientName: string) {
  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
  });

  const supabaseClient = initializeSupabaseClient(clientName);

  return new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: "documents",
    queryName: "match_documents",
  });
}

export async function similaritySearch(clientName: string, query: string, k: number = 1, filter: any = {}): Promise<[Document, number][]> {
  const vectorStore = initializeVectorStore(clientName);
  return await vectorStore.similaritySearchWithScore(query, k, filter);
}

/*
* Add documents to the vector store.
* @param pageContents: An array of strings representing the content of each page. For cards this would be the description or title if there is no description.
* @param metadata: An array of metadata objects representing the metadata of each page. For cards this would be the card ID, and database ID.
* @param pageId: An array of page IDs. For cards this would be the card ID.
*/
export async function addDocuments(clientName: string, pageContents: string[], metadata: Record<string, any>[], pageId: number[]) {
  if (pageContents.length !== metadata.length || pageContents.length !== pageId.length) {
    throw new Error("The number of page contents must match the number of metadata objects and pageId objects.");
  }

  const vectorStore = initializeVectorStore(clientName);

  const documents: Document[] = pageContents.map((content, index) => ({
    pageContent: content,
    metadata: metadata[index],
    pageId: pageId[index]
  }));

  return await vectorStore.addDocuments(documents);
}

export async function deleteDocuments(clientName: string, ids: string[]) {
  const supabaseClient = initializeSupabaseClient(clientName);

  const { data: documentsToDelete, error } = await supabaseClient
    .from('documents')
    .select('*')
    .in('metadata->>id', ids);

  if (error) {
    throw new Error(`Error fetching documents: ${error.message}`);
  }

  if (documentsToDelete.length === 0) {
    return;
  }

  const filteredIds = documentsToDelete.map(doc => doc.id);

  const vectorStore = initializeVectorStore(clientName);
  return await vectorStore.delete({ ids: filteredIds });
}
