class Logger {
  private static getTimeStamp(): string {
    return new Date().toISOString();
  }

  static log(...messages: any[]) {
    console.log(`[${this.getTimeStamp()}] [LOG]`, ...messages);
  }

  static warn(...messages: any[]) {
    console.warn(`[${this.getTimeStamp()}] [WARN]`, ...messages);
  }

  static error(...messages: any[]) {
    console.error(`[${this.getTimeStamp()}] [ERROR]`, ...messages);
  }

  static time(label: string): void {
    console.time(`[${this.getTimeStamp()}] [TIMER] ${label}`);
  }

  static timeEnd(label: string): void {
    console.timeEnd(`[${this.getTimeStamp()}] [TIMER] ${label}`);
  }
}

export default Logger;
