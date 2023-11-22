
const logger = require('../utils/logger');

function testFunction() {
    logger.log('info', 'testFunction executed successfully');
    console.log('Test function executed');
}

module.exports = {
    testFunction
};