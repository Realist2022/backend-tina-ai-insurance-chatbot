// backend/routes/chatRoutes.js
import express from "express";
import { processChatRequest } from "../controller/ChatBotController.js"; // Adjust the path accordingly

const router = express.Router();

// Define the chat API endpoint
router.post("/chat", processChatRequest);

export default router;
