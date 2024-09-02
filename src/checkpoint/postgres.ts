import pg from "pg";
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
  step: number;
  writes: Record<string, unknown> | null;
}

export class PostgresSaver extends BaseCheckpointSaver {
  private pool: pg.Pool;

  constructor(poolConfig: pg.PoolConfig) {
    super();
    this.pool = new pg.Pool(poolConfig);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_id = config.configurable?.checkpoint_id;

    let query: string;
    let values: any[];

    if (checkpoint_id !== undefined) {
      query = `SELECT * FROM postcheckpoints WHERE thread_id = $1 AND checkpoint_id = $2`;
      values = [thread_id, checkpoint_id];
    } else {
      query = `SELECT * FROM postcheckpoints WHERE thread_id = $1 ORDER BY checkpoint_id DESC LIMIT 1`;
      values = [thread_id];
    }

    try {
      const result = await this.pool.query(query, values);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          config: {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_id: row.checkpoint_id,
            },
          },
          checkpoint: row.checkpoint as Checkpoint,
          metadata: row.metadata as CheckpointMetadata,
          parentConfig: row.parent_id
            ? {
                configurable: {
                  thread_id: row.thread_id,
                  checkpoint_id: row.parent_id,
                },
              }
            : undefined,
        };
      }
    } catch (error) {
      Logger.error("Error retrieving checkpoint:", error);
    }

    return undefined;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const query = `
      INSERT INTO postcheckpoints (thread_id, checkpoint_id, parent_id, checkpoint, metadata, step, agent_name, agent_description, card_id, insights)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (thread_id, checkpoint_id) 
      DO UPDATE SET 
        parent_id = EXCLUDED.parent_id, 
        checkpoint = EXCLUDED.checkpoint, 
        metadata = EXCLUDED.metadata, 
        step = EXCLUDED.step,
        agent_name = EXCLUDED.agent_name,
        agent_description = EXCLUDED.agent_description,
        card_id = EXCLUDED.card_id,
        insights = EXCLUDED.insights
    `;
    const values = [
      config.configurable?.thread_id,
      checkpoint.id,
      config.configurable?.checkpoint_id,
      JSON.stringify(checkpoint),
      JSON.stringify(metadata),
      metadata.step,
      checkpoint?.channel_values?.agentName || checkpoint?.channel_values?.dataAgent,
      checkpoint?.channel_values?.agentDescription,
      checkpoint?.channel_values?.cardId,
      checkpoint?.channel_values?.solve && checkpoint?.versions_seen?.getInsights
    ? checkpoint?.channel_values?.result
    : []
    ];
  
    try {
      await this.pool.query(query, values);
      return {
        configurable: {
          thread_id: config.configurable?.thread_id,
          checkpoint_id: checkpoint.id,
        },
      };
    } catch (error) {
      Logger.error("Error saving checkpoint:", error);
      throw error;
    }
  }

  async *list(
    config: RunnableConfig,
    limit?: number,
    before?: RunnableConfig
  ): AsyncGenerator<CheckpointTuple> {
    let query = `
      SELECT * FROM postcheckpoints 
      WHERE thread_id = $1
    `;
    const values: any[] = [config.configurable?.thread_id];

    if (before?.configurable?.checkpoint_id) {
      query += ` AND checkpoint_id < $${values.length + 1}`;
      values.push(before.configurable.checkpoint_id);
    }

    query += ` ORDER BY checkpoint_id DESC`;

    if (limit) {
      query += ` LIMIT $${values.length + 1}`;
      values.push(limit);
    }

    try {
      const result = await this.pool.query(query, values);
      for (const row of result.rows) {
        yield {
          config: {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_id: row.checkpoint_id,
            },
          },
          checkpoint: JSON.parse(row.checkpoint),
          metadata: JSON.parse(row.metadata),
          parentConfig: row.parent_id
            ? {
                configurable: {
                  thread_id: row.thread_id,
                  checkpoint_id: row.parent_id,
                },
              }
            : undefined,
        };
      }
    } catch (error) {
      Logger.error("Error listing checkpoints:", error);
    }
  }

  async close() {
    await this.pool.end();
  }
}