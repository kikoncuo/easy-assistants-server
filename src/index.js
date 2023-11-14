const app = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    logger.logWithThreadId('info', `Server running on port ${PORT}`);
});
