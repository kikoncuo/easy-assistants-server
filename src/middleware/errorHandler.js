const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
    // Extract the thread ID if it exists in the request body
    const threadId = req.body?.threadId;

    // Log the error with additional context
    logger.logWithThreadId('error', `Unhandled error in the application: ${err.message}`, threadId);

    // Send a generic error message to the client
    res.status(500).json({ message: 'An error occurred. Please try again later.' });
}

module.exports = errorHandler;
