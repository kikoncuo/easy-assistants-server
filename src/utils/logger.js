const winston = require('winston');
const { combine, timestamp, printf, colorize } = winston.format;

// Define your custom format for logs
const myFormat = printf(({ level, message, threadId, timestamp }) => {
  return `${timestamp} [${threadId || 'No Thread ID'}] ${level}: ${message}`;
});

// Set the log level based on an environment variable, defaulting to 'info'
const logLevel = process.env.LOG_LEVEL || 'info';

// Configure the logger
const logger = winston.createLogger({
  level: logLevel,
  format: combine(
    timestamp(),
    //colorize(), For some reason this crashes
    myFormat
  ),
  defaultMeta: { service: 'AssistantService' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// In non-production environments, also log to the console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      //colorize(),
      timestamp(),
      myFormat
    ),
  }));
}

// Function to log messages with thread ID
function logWithThreadId(level, message, threadId = null) {
  logger.log({
    level,
    message,
    threadId,
  });
}

module.exports = {
  logWithThreadId,
};
