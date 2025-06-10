// backend/routes/chatRoutes.js

const express = require("express");
const { processChatRequest } = require("../controller/ChatBotController"); // Adjust the path accordingly

const router = express.Router();

// Define the chat API endpoint
router.post("/chat", processChatRequest);

module.exports = router;
