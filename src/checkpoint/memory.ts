import { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  Checkpoint,

} from "@langchain/langgraph";
import { SerializerProtocol } from "../serde/base.js";
import { CheckpointMetadata, CheckpointTuple } from "./supabase.js";

export class MemorySaver extends BaseCheckpointSaver {
  storage: Record<string, Record<string, [string, string]>>;

  constructor(serde?: SerializerProtocol<unknown>) {
    super(serde);
    this.storage = {};
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_id = config.configurable?.checkpoint_id;
    const checkpoints = this.storage[thread_id];

    if (checkpoint_id) {
      const checkpoint = checkpoints[checkpoint_id];
      if (checkpoint) {
        return {
          config,
          checkpoint: (JSON.parse(checkpoint[0])) as Checkpoint,
          metadata: (JSON.parse(
            checkpoint[1]
          )) as CheckpointMetadata,
        };
      }
    } else {
      if (checkpoints) {
        const maxThreadTs = Object.keys(checkpoints).sort((a, b) =>
          b.localeCompare(a)
        )[0];
        const checkpoint = checkpoints[maxThreadTs];
        return {
          config: { configurable: { thread_id, checkpoint_id: maxThreadTs } },
          checkpoint: (JSON.parse(checkpoint[0])) as Checkpoint,
          metadata: (JSON.parse(
            checkpoint[1]
          )) as CheckpointMetadata,
        };
      }
    }

    return undefined;
  }

  async *list(
    config: RunnableConfig,
    limit?: number,
    before?: RunnableConfig
  ): AsyncGenerator<CheckpointTuple> {
    const thread_id = config.configurable?.thread_id;
    const checkpoints = this.storage[thread_id] ?? {};

    // sort in desc order
    for (const [checkpoint_id, checkpoint] of Object.entries(checkpoints)
      .filter((c) =>
        before ? c[0] < before.configurable?.checkpoint_id : true
      )
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, limit)) {
      yield {
        config: { configurable: { thread_id, checkpoint_id } },
        checkpoint: (JSON.parse(checkpoint[0])) as Checkpoint,
        metadata: (JSON.parse(checkpoint[1])) as CheckpointMetadata,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const thread_id = config.configurable?.thread_id;

    if (this.storage[thread_id]) {
      this.storage[thread_id][checkpoint.id] = [
        JSON.stringify(checkpoint),
        JSON.stringify(metadata),
      ];
    } else {
      this.storage[thread_id] = {
        [checkpoint.id]: [
          JSON.stringify(checkpoint),
          JSON.stringify(metadata),
        ],
      };
    }

    return {
      configurable: {
        thread_id,
        checkpoint_id: checkpoint.id,
      },
    };
  }
}
