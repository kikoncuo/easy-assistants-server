import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  Checkpoint,
//   CheckpointMetadata,
//   CheckpointTuple,
} from "@langchain/langgraph";
import { SerializerProtocol } from "../serde/base";

interface CheckpointRow {
  thread_id: string;
  checkpoint_id: string;
  parent_id?: string;
  checkpoint: Buffer;
  metadata: Buffer;
}

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
    serde?: SerializerProtocol<Checkpoint>
  ) {
    super(serde);
    this.supabase = client || createClient(url, apiKey);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { data, error } = await this.supabase
      .from("newcheckpoints")
      .select("*")
      .eq("thread_id", config.configurable?.thread_id)
      .eq("checkpoint_id", config.configurable?.checkpoint_id)
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

    return undefined;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const { data, error } = await this.supabase
      .from("newcheckpoints")
      .insert([
        {
          thread_id: config.configurable?.thread_id,
          checkpoint_id: checkpoint.id,
          parent_id: config.configurable?.checkpoint_id,
          checkpoint: checkpoint,
          metadata: metadata,
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
    console.log('Function called with config:', config, 'limit:', limit, 'before:', before);
    let query = this.supabase
      .from("newcheckpoints")
      .select("*")
      .eq("thread_id", config.configurable?.thread_id)
      .order("checkpoint_id", { ascending: false });
      console.log('queryyyyyyyyyyyyyyy', query)
      console.log('frommmmmmmmm list',before?.configurable?.checkpoint_id)
    if (before?.configurable?.checkpoint_id) {
      query = query.lt("checkpoint_id", before.configurable.checkpoint_id);
    } else {
        console.log('Before condition is not provided or checkpoint_id is undefined');
      }
    console.log('after checkpoint',query)
    if (limit) {
      query = query.limit(limit);
    }
    console.log('after limit',query)
    const { data, error } = await query;
    console.log('Query executed. Data:', data, 'Error:', error);

    if (error) {
      console.error("Error listing checkpoints:", error);
      return;
    }

    if (data) {
        console.log('Data retrieved from mock client:', data); 
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