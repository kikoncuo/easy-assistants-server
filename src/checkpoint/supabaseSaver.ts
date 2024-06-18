import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { RunnableConfig } from "@langchain/core/runnables";
import { BaseCheckpointSaver, Checkpoint } from '@langchain/langgraph';

export class SupabaseSaver extends BaseCheckpointSaver {
  public supabase;
  private cachedCheckpoint: Checkpoint | undefined;
  private cachedCheckpoints: Record<string, Checkpoint | undefined> = {};


  constructor(
    private url: string,
    private apiKey: string,
    client?: SupabaseClient
  ) {
    super();
    this.supabase = client || createClient(url, apiKey);
  }

//   get configSpecs() {
//     return [
//         {
//             id: "threadId",
//             name: "Thread ID",
//             annotation: null,
//             description: null,
//             default: null,
//             isShared: true,
//             dependencies: null,
//         },
//     ];
// }

// get(config: RunnableConfig): Checkpoint | undefined {
//   return this.cachedCheckpoint;
// }

// async updateCache(config: RunnableConfig): Promise<void> {
//   this.cachedCheckpoint = await this.fetchCheckpointFromSupabase(config);
// }

// get(config: RunnableConfig): Checkpoint | undefined {
//     console.log('frommmmmmmm getttttt config',config)
//     const threadId = config.configurable?.thread_id as string;
//     console.log('frommmmmmmm getttttt threadId',threadId)
//     console.log('frommmmmmmm getttttt',this.cachedCheckpoints[threadId])
//     return this.cachedCheckpoints[threadId];
//   }

//   async updateCache(config: RunnableConfig): Promise<void> {
//     const threadId = config.configurable?.thread_id as string;
//     console.log("frommmmmmmm update cacheeeeeeeeee",threadId)
//     if (!threadId) {
//       throw new Error("Thread ID is required");
//     }

//     try {
//       const checkpoint = await this.fetchCheckpointFromSupabase(threadId);
//       this.cachedCheckpoints[threadId] = checkpoint;
//       console.log('frommmmm tryyyyyyyyy', this.cachedCheckpoints[threadId])
//     } catch (error) {
//       console.error(`Error updating cache for thread ${threadId}:`, error);
//       this.cachedCheckpoints[threadId] = undefined;
//     }
//   }

// get(config: RunnableConfig): Checkpoint | undefined {
//     const threadId = config.configurable?.thread_id;
//     let data: any;
//     let error: any;
//     this.supabase
//       .from('checkpoints')
//       .select('*')
//       .eq('thread_id', threadId)
//       .order('created_at', { ascending: false })
//       .limit(1)
//       .single()
//       .then((result: { data: any, error: any }) => {
//         data = result.data;
//         console.log('frommmmm thennnnnnn', data?.checkpoint)
//         return data?.checkpoint
//         error = result.error;
//       })
//     //   .catch((err: any) => {
//     //     console.error('Error fetching checkpoint:', err);
//     //     error = err;
//     //   });
//     if (error) {
//       console.error('Error fetching checkpoint:', error);
//       return undefined;
//     }
//     console.log('afterrrrrrrrr thennnnnnn', data?.checkpoint)
//     return data?.checkpoint || null;
//   }

async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
  const threadId = config.configurable?.thread_id;
  console.log('fetching thread id',config)
console.log('from fetchingggggggggggg checkkkkkkkkkkkkkpointtttttttttt',threadId)
  const { data, error } = await this.supabase
    .from('checkpoints')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error('Error fetching checkpoint:', error);
    return undefined;
  }

  console.log('data fetchinggggggggggggg',data)

  return data?.checkpoint || null;
}

async put(config: RunnableConfig, checkpoint: Checkpoint): Promise<void> {
    // console.log('from put', checkpoint);

  const threadId = config.configurable?.thread_id;
  if (threadId === undefined) {
    throw new Error('Thread ID is undefined: ' + threadId);
  }
  const { error } = await this.supabase.from('checkpoints').upsert({
    thread_id: threadId,
    checkpoint: checkpoint,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Error saving checkpoint:', error);
  }
 }
}

export class SupabaseSaverAssertImmutable extends SupabaseSaver {
  constructor(supabaseUrl: string, supabaseKey: string) {
    super(supabaseUrl, supabaseKey);
  }
  async put(config: RunnableConfig, checkpoint: Checkpoint): Promise<void> {
      console.log('frommmm supabse saver assert')
    const threadId = config.configurable?.thread_id;
    console.log("from saverAssertImmutable", threadId)

    const saved = super.get(config);

    if (saved) {
      const { data: savedCopy, error: fetchError } = await this.supabase
        .from('checkpoints')
        .select('*')
        .eq('thread_id', threadId)
        // .eq('checkpoint->ts', saved.ts)
        .single();

      if (fetchError) {
        console.error('Error fetching saved checkpoint copy:', fetchError);
      } else if (savedCopy) {
        console.assert(
          JSON.stringify(savedCopy.checkpoint) === JSON.stringify(saved),
          'Checkpoint has been modified'
        );
      }
    }

    await super.put(config, checkpoint);
  }
}
