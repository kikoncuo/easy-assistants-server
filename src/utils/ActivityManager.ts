import Logger from './Logger';
import OpenAI from 'openai';
import { cancelRun, checkStreamStatus } from './Stream';

export class ActivityManager {
    private lastActivityTimestamp: number;
    private streamStatus: 'active' | 'inactive';
    private inactivityTimeout: ReturnType<typeof setTimeout> | null;
    private currentRunId: string | null;
    private codeInterpreterThreadId: string | null;
    private openai: OpenAI;

    constructor(openai: OpenAI) {
        this.lastActivityTimestamp = Date.now();
        this.streamStatus = 'active';
        this.inactivityTimeout = null;
        this.currentRunId = null;
        this.codeInterpreterThreadId = null;
        this.openai = openai;
    }

    private checkInactivity = async () => {
        const currentTime = Date.now();
        if (currentTime - this.lastActivityTimestamp > 60000) { // 1 minute
            if (this.currentRunId && this.codeInterpreterThreadId) {
                const status = await this.checkStatus();
                console.log('status', status);
                if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
                    const cancelled = await cancelRun(this.codeInterpreterThreadId, this.currentRunId, this.openai);
                    if (cancelled) {
                        Logger.log(`Stream stopped due to inactivity. Run ID: ${this.currentRunId}`);
                        this.streamStatus = 'inactive';
                    }
                } else {
                    this.streamStatus = 'inactive';
                    Logger.log(`Stream already ${status}. Run ID: ${this.currentRunId}`);
                }
            }
        } else {
            this.inactivityTimeout = setTimeout(this.checkInactivity, 60000 - (currentTime - this.lastActivityTimestamp));
        }
    };

    public updateActivity = () => {
        this.lastActivityTimestamp = Date.now();
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }
        this.inactivityTimeout = setTimeout(this.checkInactivity, 60000);
    };

    public startMonitoring(runId: string, threadId: string) {
        this.currentRunId = runId;
        this.codeInterpreterThreadId = threadId;
        this.inactivityTimeout = setTimeout(this.checkInactivity, 60000);
    }

    public stopMonitoring() {
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }
        this.inactivityTimeout = null;
        this.currentRunId = null;
        this.codeInterpreterThreadId = null;
    }

    public getStreamStatus() {
        return this.streamStatus;
    }

    public async checkStatus(): Promise<string> {
        if (this.currentRunId && this.codeInterpreterThreadId) {
            return await checkStreamStatus(this.openai, this.codeInterpreterThreadId, this.currentRunId);
        }
        return 'unknown';
    }
}