require('dotenv').config();
const express = require('express');
const chatController = require('./controllers/chatController');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.post('/chat', chatController.handleChatRequest);

app.use(errorHandler);

module.exports = app;
