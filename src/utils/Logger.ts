class Logger {
  private static getTimeStamp(): string {
    return new Date().toISOString();
  }
  private static truncateMessage(message: string, maxLength: number): { message: string, truncated: boolean } {
    if (message.length > maxLength) {
      return { message: message.substring(0, maxLength) + '...', truncated: true };
    }
    return { message, truncated: false };
  }
  private static formatMessages(messages: any[]): string[] {
    return messages.map(msg => {
      if (typeof msg === 'object') {
        return JSON.stringify(msg, null, 2);
      }
      return String(msg);
    });
  }
  static log(...messages: any[]) {
    const formattedMessages = this.formatMessages(messages);
    const truncatedMessages = formattedMessages.map(msg => this.truncateMessage(msg, 15000));
    truncatedMessages.forEach((msg, index) => {
      if (msg.truncated) {
        console.warn(`[${this.getTimeStamp()}] [WARN] Message truncated: original length ${formattedMessages[index].length}`);
      }
    });
    console.log(`[${this.getTimeStamp()}] [LOG]`, ...truncatedMessages.map(msg => msg.message));
  }
  static warn(...messages: any[]) {
    const formattedMessages = this.formatMessages(messages);
    const truncatedMessages = formattedMessages.map(msg => this.truncateMessage(msg, 15000));
    truncatedMessages.forEach((msg, index) => {
      if (msg.truncated) {
        console.warn(`[${this.getTimeStamp()}] [WARN] Message truncated: original length ${formattedMessages[index].length}`);
      }
    });
    console.warn(`[${this.getTimeStamp()}] [WARN]`, ...truncatedMessages.map(msg => msg.message));
  }
  static error(...messages: any[]) {
    const formattedMessages = this.formatMessages(messages);
    const truncatedMessages = formattedMessages.map(msg => this.truncateMessage(msg, 15000));
    truncatedMessages.forEach((msg, index) => {
      if (msg.truncated) {
        console.warn(`[${this.getTimeStamp()}] [WARN] Message truncated: original length ${formattedMessages[index].length}`);
      }
    });
    console.error(`[${this.getTimeStamp()}] [ERROR]`, ...truncatedMessages.map(msg => msg.message));
  }
  static time(label: string): void {
    console.time(`[${this.getTimeStamp()}] [TIMER] ${label}`);
  }
  static timeEnd(label: string): void {
    console.timeEnd(`[${this.getTimeStamp()}] [TIMER] ${label}`);
  }
}
export default Logger;