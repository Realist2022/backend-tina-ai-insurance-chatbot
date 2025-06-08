const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const ChatBotController = require('./controller/ChatBotController');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const chatBotController = new ChatBotController(process.env.GOOGLE_API_KEY);

app.post('/api/ChatBot', (req, res) => chatBotController.handle(req, res));


app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});