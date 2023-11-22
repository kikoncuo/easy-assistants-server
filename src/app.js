// app.js
require('dotenv').config();
const express = require('express');
const chatController = require('./controllers/chatController');
const fileController = require('./controllers/fileController'); // New controller
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.post('/chat', chatController.handleChatRequest);
app.get('/files/:fileId', fileController.handleFileRequest); // New route

app.use(errorHandler);

module.exports = app;
