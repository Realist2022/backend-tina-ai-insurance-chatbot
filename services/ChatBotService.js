// backend/services/chatbotService.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config"; // Loads environment variables from .env file
import {
  interviewStages,
  MAX_FOLLOW_UP_QUESTIONS,
} from "../prompts/InsurancePrompts.js"; // Adjust the path and ensure .js extension

// ERROR HANDLING: Check if GOOGLE_API_KEY is set in .env
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_API_KEY is not set in .env");
  process.exit(1);
}

// CHATBOT SERVICE: class container for chatbot logic
class ChatbotService {
  // INTERVIEW STAGES: Excludes awaiting opt-in and follow-up questions stages from user answers
  static STAGES_TO_EXCLUDE_USER_ANSWERS = [
    "initial",
    "pre_feedback", // user's response in this stage isn't a direct answer to a policy question
    "generating_feedback",
    "interview_complete",
  ];

  // Private class field for the generative model
  #model;
  // CHAT SESSION MANAGEMENT: Map to store chat histories
  chatHistories = new Map();
  // INTERVIEW STAGES
  interviewStages = interviewStages;

  // CONSTRUCTOR KEY: initializes GoogleGenerativeAI
  constructor(apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.#model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
    });
  }

  // SEND MODEL MESSAGE: This private method sends a message to the model and returns the response
  async #sendModelMessage(instruction, history, generationConfig = {}) {
    const safeHistory = history.filter(
      // Filter the chat history to remove any messages that should not be sent to the model
      (msg, idx) => !(idx === 0 && msg.role === "model") // Exclude the first message if it's from the model (e.g., initial greeting)
    );

    // CREATE CHAT: This creates a chat session with the model
    const chat = this.#model.startChat({
      history: safeHistory.map(({ role, text }) => ({
        role,
        parts: [{ text }],
      })),
      generationConfig,
    });

    // SEND MESSAGE: This sends the instruction to the model and returns the response
    const result = await chat.sendMessage(instruction);
    return result.response.text();
  }

  // PROCESS INTERVIEW TURN: This block processes interview stages and handles user responses
  async processInterviewTurn({
    history,
    followUpCount,
    interviewStage,
    userAnswers,
    userResponse, // Added userResponse to processInterviewTurn arguments
  }) {
    // CURRENT STAGE CONFIG: This property holds the interview stages (e.g., initial, asking follow-ups)
    const currentStageConfig = this.interviewStages[interviewStage];

    // ERROR HANDLING: If the current stage configuration is not found, log a warning
    if (!currentStageConfig) {
      console.warn(`Unknown interview stage: ${interviewStage}`);
      return {
        modelResponseText: "An error occurred (unknown stage).",
        newInterviewStage: interviewStage,
        newFollowUpCount: followUpCount,
      };
    }

    let instructionToAI = currentStageConfig.instruction(userAnswers);

    let modelResponseText = "";
    let newInterviewStage = interviewStage;
    let newFollowUpCount = followUpCount;

    // Logic for transitioning from initial stages
    if (interviewStage === "initial") {
      modelResponseText = await this.#sendModelMessage(
        instructionToAI,
        history,
        currentStageConfig.generationConfig || {}
      );
      newInterviewStage = currentStageConfig.nextStage;
      newFollowUpCount = 0;
    } else if (interviewStage === "awaiting_opt_in_response") {
      modelResponseText = await this.#sendModelMessage(
        instructionToAI,
        history,
        currentStageConfig.generationConfig || {}
      );
      newInterviewStage = currentStageConfig.nextStage;
      newFollowUpCount = 0;
    } else if (interviewStage === "asking_follow_ups") {
      newFollowUpCount++;

      // Use MAX_FOLLOW_UP_QUESTIONS from the imported prompts
      if (newFollowUpCount > MAX_FOLLOW_UP_QUESTIONS) {
        newInterviewStage = "pre_feedback"; // Transition to pre_feedback
        modelResponseText = await this.#sendModelMessage(
          this.interviewStages[newInterviewStage].instruction(),
          history,
          this.interviewStages[newInterviewStage].generationConfig || {}
        );
      } else {
        modelResponseText = await this.#sendModelMessage(
          instructionToAI,
          history,
          currentStageConfig.generationConfig || {}
        );
      }
    } else if (interviewStage === "pre_feedback") {
      const lowerCaseResponse = userResponse.toLowerCase();
      if (lowerCaseResponse.includes("yes")) {
        newInterviewStage = "asking_follow_ups";
        newFollowUpCount = 0; // Reset follow-up count for new questions
        // Generate a new follow-up question
        modelResponseText = await this.#sendModelMessage(
          this.interviewStages[newInterviewStage].instruction(),
          history,
          this.interviewStages[newInterviewStage].generationConfig || {}
        );
      } else if (lowerCaseResponse.includes("no")) {
        newInterviewStage = "generating_feedback";
        instructionToAI =
          this.interviewStages[newInterviewStage].instruction(userAnswers);
        modelResponseText = await this.#sendModelMessage(
          instructionToAI,
          history,
          this.interviewStages[newInterviewStage].generationConfig || {}
        );
      } else {
        // If the user's response is unclear, ask the question again or guide them.
        modelResponseText =
          'I didn\'t quite catch that. Please type "yes" to ask another question, or "no" to get your insurance recommendation.';
        newInterviewStage = "pre_feedback"; // Stay in pre_feedback
      }
    } else {
      modelResponseText = await this.#sendModelMessage(
        instructionToAI,
        history,
        currentStageConfig.generationConfig || {}
      );
      newInterviewStage = currentStageConfig.nextStage;
    }

    return { modelResponseText, newInterviewStage, newFollowUpCount };
  }
}

// Export a singleton instance of the chatbot service
const chatbotServiceInstance = new ChatbotService(apiKey);
export default chatbotServiceInstance;
