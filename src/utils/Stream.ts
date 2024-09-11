import OpenAI from 'openai';
import Logger from './Logger';

export async function cancelRun(
    threadId: string,
    runId: string,
    openai?: OpenAI
): Promise<boolean> {
    try {
        if (!openai) {
            openai = new OpenAI();
        }
        await openai.beta.threads.runs.cancel(threadId, runId);
        Logger.log(`Stream stopped. Run ID: ${runId}`);
        return true;
    } catch (error) {
        Logger.error(`Failed to stop stream: ${error}`);
        return false;
    }
}

export async function checkStreamStatus(
    openai: OpenAI,
    threadId: string,
    runId: string
): Promise<string> {
    try {
        const run = await openai.beta.threads.runs.retrieve(threadId, runId);
        Logger.log(`Stream status checked. Run ID: ${runId}, Status: ${run.status}`);
        return run.status;
    } catch (error) {
        Logger.error(`Failed to check stream status: ${error}`);
        throw error;
    }
}