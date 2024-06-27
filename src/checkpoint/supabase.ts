import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  Checkpoint,
} from "@langchain/langgraph";
import Logger from '../utils/Logger';

export interface CheckpointTuple {
    config: RunnableConfig;
    checkpoint: Checkpoint;
    metadata?: CheckpointMetadata;
    parentConfig?: RunnableConfig;
  }

  export interface CheckpointMetadata {
    source: "input" | "loop" | "update";
    /**
     * The source of the checkpoint.
     * - "input": The checkpoint was created from an input to invoke/stream/batch.
     * - "loop": The checkpoint was created from inside the pregel loop.
     * - "update": The checkpoint was created from a manual state update. */
    step: number;
    /**
     * The step number of the checkpoint.
     * -1 for the first "input" checkpoint.
     * 0 for the first "loop" checkpoint.
     * ... for the nth checkpoint afterwards. */
    writes: Record<string, unknown> | null;
    /**
     * The writes that were made between the previous checkpoint and this one.
     * Mapping from node name to writes emitted by that node.
     */
  }

export class SupabaseSaver extends BaseCheckpointSaver {
  private supabase;

  constructor(
    private url: string,
    private apiKey: string,
    client?: SupabaseClient,
  ) {
    super();
    this.supabase = client || createClient(url, apiKey);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_id = config.configurable?.checkpoint_id;
  
    if (checkpoint_id !== undefined) {
      const { data, error } = await this.supabase
        .from("newcheckpoints")
        .select("*")
        .eq("thread_id", thread_id)
        .eq("checkpoint_id", checkpoint_id)
        .single();
  
      if (error) {
        console.error("Error retrieving checkpoint:", error);
        return undefined;
      }
  
      if (data) {
        const { thread_id, checkpoint_id, parent_id, checkpoint, metadata } = data;
        return {
          config,
          checkpoint: checkpoint as Checkpoint,
          metadata: metadata as CheckpointMetadata,
          parentConfig: parent_id
            ? {
                configurable: {
                  thread_id,
                  checkpoint_id: parent_id,
                },
              }
            : undefined,
        };
      }
    } else {
      
      const { data, error } = await this.supabase
        .from("newcheckpoints")
        .select("*")
        .eq("thread_id", thread_id)
        .order("checkpoint_id", { ascending: false })
        .limit(1)
        .single();
  
      if (error) {
        console.error("Error retrieving checkpoint:", error);
        return undefined;
      }
  
      if (data) {
        const { thread_id, checkpoint_id, parent_id, checkpoint, metadata } = data;
        return {
          config: {
            configurable: {
              thread_id,
              checkpoint_id,
            },
          },
          checkpoint: (JSON.parse(checkpoint)) as Checkpoint,
          metadata: (JSON.parse(
            metadata
          )) as CheckpointMetadata,
          parentConfig: parent_id
            ? {
                configurable: {
                  thread_id,
                  checkpoint_id: parent_id,
                },
              }
            : undefined,
        };
      }
    }
  
    return undefined;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {

    const { data, error } = await this.supabase
      .from("newcheckpoints")
      .upsert([
        {
          thread_id: config.configurable?.thread_id,
          checkpoint_id: checkpoint.id,
          parent_id: config.configurable?.checkpoint_id,
          checkpoint: checkpoint,
          metadata: metadata,
          step: metadata.step
        },
      ])
      .single();

    if (error) {
      console.error("Error saving checkpoint:", error);
      throw error;
    }

    return {
      configurable: {
        thread_id: config.configurable?.thread_id,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async *list(
    config: RunnableConfig,
    limit?: number,
    before?: RunnableConfig
  ): AsyncGenerator<CheckpointTuple> {
    let query = this.supabase
      .from("newcheckpoints")
      .select("*")
      .eq("thread_id", config.configurable?.thread_id)
      .order("checkpoint_id", { ascending: false });

    if (before?.configurable?.checkpoint_id) {
      query = query.lt("checkpoint_id", before.configurable.checkpoint_id);
    } else {
        Logger.log('Before condition is not provided or checkpoint_id is undefined');
      }
    if (limit) {
      query = query.limit(limit);
    }
    const { data, error } = await query;

    if (error) {
      Logger.error("Error listing checkpoints:", error);
      return;
    }

    if (data) {
      for (const row of data) {
        const {
          thread_id,
          checkpoint_id,
          parent_id,
          checkpoint,
          metadata,
        } = row;

        yield {
          config: {
            configurable: {
              thread_id,
              checkpoint_id,
            },
          },
          checkpoint: checkpoint,
          metadata: metadata,
          parentConfig: parent_id
            ? {
                configurable: {
                  thread_id,
                  checkpoint_id: parent_id,
                },
              }
            : undefined,
        };
      }
    }
  }
}