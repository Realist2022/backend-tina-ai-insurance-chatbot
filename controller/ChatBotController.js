// backend/controller/ChatBotController.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const {
  interviewStages,
  INSURANCE_URL_CONTEXT,
  MAX_FOLLOW_UP_QUESTIONS,
} = require("../prompts/InsurancePrompts"); // Adjust the path accordingly

// ERROR HANDLING: Check if GOOGLE_API_KEY is set in .env
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_API_KEY is not set in .env");
  process.exit(1);
}

// CHATBOT CONTROLLER: class container
class ChatBotController {
  // INTERVIEW STAGES: Excludes awaiting opt-in and follow-up questions stages from user answers
  static STAGES_TO_EXCLUDE_USER_ANSWERS = [
    "initial",
    "pre_feedback",
    "generating_feedback",
    "interview_complete",
  ];

  // CONSTRUCTOR KEY: initializes GoogleGenerativeAI
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
    });

    // CHAT SESSION MANAGEMENT: Map to store chat histories
    this.chatHistories = new Map();

    // INTERVIEW STAGES
    this.interviewStages = interviewStages; // Use the imported interviewStages
  }

  // SEND MODEL MESSAGE: This method sends a message to the model and returns the response
  async #sendModelMessage(instruction, history, generationConfig = {}) {
    const safeHistory = history.filter(
      // Filter the chat history to remove any messages that should not be sent to the model
      (msg, idx) => !(idx === 0 && msg.role === "model") // Exclude the first message if it's from the model (e.g., initial greeting)
    );

    // CREATE CHAT: This creates a chat session with the model
    const chat = this.model.startChat({
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

    // MAIN LOGIC: Prepare the instruction to AI based on the current stage and user answers
    const instructionToAI = currentStageConfig.instruction(userAnswers);

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
        // Changed this line
        newInterviewStage = currentStageConfig.nextStage;
        modelResponseText = await this.#sendModelMessage(
          this.interviewStages[newInterviewStage].instruction(userAnswers),
          history,
          this.interviewStages[newInterviewStage].generationConfig || {}
        );
        return { modelResponseText, newInterviewStage, newFollowUpCount };
      } else {
        modelResponseText = await this.#sendModelMessage(
          instructionToAI,
          history,
          currentStageConfig.generationConfig || {}
        );
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

  // MAIN HANDLER for the chat bot controller
  async handle(req, res) {
    const { sessionId, userResponse } = req.body;

    // ERROR HANDLING: Validate the sessionId and userResponse
    if (!sessionId || userResponse === undefined) {
      return res
        .status(400)
        .json({ error: "Missing sessionId or userResponse." });
    }

    // MAIN LOGIC: Try/catch block to handle the interview process
    try {
      // SESSION MANAGEMENT: This creates a new session if sessionId doesn't exist
      let session = this.chatHistories.get(sessionId);
      if (!session) {
        session = {
          history: [],
          interviewStage: "initial",
          followUpCount: 0,
          userAnswers: [],
        };
        this.chatHistories.set(sessionId, session);
      }

      // USER RESPONSE HANDLING: Process the user response and update the session
      if (userResponse !== "start interview") {
        session.history.push({ role: "user", text: userResponse });
        if (
          !ChatBotController.STAGES_TO_EXCLUDE_USER_ANSWERS.includes(
            session.interviewStage
          )
        ) {
          session.userAnswers.push(userResponse);
        }
      }

      // PREPARE TURN ARGS: Prepare the arguments for the processInterviewTurn method
      const turnArgs = {
        history: session.history,
        followUpCount: session.followUpCount,
        interviewStage: session.interviewStage,
        userAnswers: session.userAnswers,
      };
      // PROCESS INTERVIEW TURN: Call the processInterviewTurn method with the prepared arguments
      const { modelResponseText, newInterviewStage, newFollowUpCount } =
        await this.processInterviewTurn(turnArgs);

      if (modelResponseText) {
        session.history.push({ role: "model", text: modelResponseText });
      }
      // UPDATE SESSION: Update the session with the new interview stage and follow-up count
      session.interviewStage = newInterviewStage;
      session.followUpCount = newFollowUpCount;

      // RESPONSE: Send the response back to the frontend
      res.json({
        response: modelResponseText,
        history: session.history,
        interviewStage: newInterviewStage,
        followUpCount: newFollowUpCount,
      });
      // ERROR HANDLING: for ChatBotController
    } catch (err) {
      console.error("Error calling ChatBotController:", err.message, err.stack);
      res.status(500).json({ error: "Failed to process interview." });
    }
  }
}

module.exports = ChatBotController;
