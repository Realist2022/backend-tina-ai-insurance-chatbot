const { GoogleGenerativeAI } = require("@google/generative-ai"); 
require("dotenv").config(); 

// ERROR HANDLING: Check if GOOGLE_API_KEY is set in .env
const apiKey = process.env.GOOGLE_API_KEY; 
if (!apiKey) {
  console.error("GOOGLE_API_KEY is not set in .env");
  process.exit(1);
}

// HARDCODED URL: context for insurance policies
const INSURANCE_URL_CONTEXT = `
  - Mechanical Breakdown Insurance: https://www.moneyhub.co.nz/mechanical-breakdown-insurance.html
  - Car Insurance: https://www.moneyhub.co.nz/car-insurance.html
  - Third-Party Car Insurance: https://www.moneyhub.co.nz/third-party-car-insurance.html
`;

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

    // MAXIMUM FOLLOW-UP QUESTIONS: defines the maximum number of follow-up questions
    const MAX_FOLLOW_UP_QUESTIONS = 2; 

    // INTERVIEW STAGES
    this.interviewStages = {
      initial: {
        // INITIAL STAGE: where the AI introduces itself
        instruction: () =>
          `You are an AI insurance consultant named Tina. Introduce yourself and ask the user for permission to begin the consultation with this exact phrase: "I’m Tina. I help you to choose the right insurance policy. May I ask you a few personal questions to make sure I recommend the best policy for you?" Do not ask any other questions yet.`,
        nextStage: "awaiting_opt_in_response",
      },
      // AWAITING OPT-IN RESPONSE: where the AI waits for the user's response
      awaiting_opt_in_response: {
        instruction: () =>
          `The user has responded to your opt-in question. If they responded positively (e.g., "yes", "ok", "sure"), then ask your first question to determine their needs: "Great! To get started, could you tell me a little about your vehicle and what you're looking for in an insurance policy?". If they responded negatively, politely end the conversation.`,
        nextStage: "asking_follow_ups", 
      },
      // ASKING FOLLOW-UPS: where the AI asks follow-up questions
      asking_follow_ups: {
        instruction: () =>
          `You are an AI insurance assistant with context on these policies: ${INSURANCE_URL_CONTEXT}. The customer has just responded to your last question. Ask one more relevant follow-up question to clarify their needs and guide them towards the most suitable policy. Analyze their previous response to formulate your question. Keep it concise.`,
        generationConfig: { maxOutputTokens: 200 }, // Limit the response length to 200 tokens around 140 words
        maxFollowUps: MAX_FOLLOW_UP_QUESTIONS, 
        nextStage: "pre_feedback", 
      },
      // PRE-FEEDBACK: where the AI prepares to give feedback
      pre_feedback: {
        instruction: () =>
          `You are an AI insurance assistant. The question phase is complete. Do not ask more questions. Acknowledge this and inform the user you will now recommend a policy based on their answers after they type "yes" and click submit. Keep the response concise.`,
        generationConfig: { maxOutputTokens: 100 }, // Limit response length to 100 tokens, around 70 words
        nextStage: "generating_feedback", 
      },
      // GENERATING FEEDBACK: AI generates feedback based on user answers and recommends a policy
      generating_feedback: {
        instruction: (
          userAnswers 
        ) =>
          `You are an AI insurance expert named Tina. Your context for policies is: ${INSURANCE_URL_CONTEXT}. 
          
          **IMPORTANT: You must follow these business rules:**
          1. Mechanical Breakdown Insurance (MBI) is NOT available for trucks or racing cars.
          2. Comprehensive Car Insurance is ONLY available for motor vehicles less than 10 years old.

          Review the user's answers: ${userAnswers 
            .map((ans, idx) => `Answer ${idx + 1}: ${ans}`) 
            .join("\n- ")} 
            
          Based on their answers and the mandatory business rules, recommend the most suitable insurance policy and explain why.`,
        generationConfig: { maxOutputTokens: 500 }, // Limit the response length to 500 tokens around 350 words
        nextStage: "interview_complete",
      },
      // INTERVIEW COMPLETE: where the AI concludes the interview with closing statement
      interview_complete: {
        instruction: () =>
          `The recommendation has been provided. Offer a polite closing statement. Thank the user for their time and invite them to ask any final questions. Keep your closing brief and friendly.`,
        generationConfig: { maxOutputTokens: 50 }, // Limit the response length to 50 tokens 35 words round about
      },
    };
  }

  // SEND MODEL MESSAGE: This method sends a message to the model and returns the response
  async #sendModelMessage(instruction, history, generationConfig = {}) {
    const safeHistory = history.filter( // Filter the chat history to remove any messages that should not be sent to the model
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
    const currentStageConfig = this.interviewStages[interviewStage]; // Get the configuration for the current interview stage

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

    // CHECK INTERVIEW STAGE & FOLLOW-UP COUNT: If conditions are met, process the next stage.
    if (
      interviewStage === "asking_follow_ups" && 
      followUpCount >= currentStageConfig.maxFollowUps 
    ) {
      return this.processInterviewTurn({
        history, 
        followUpCount, 
        interviewStage: currentStageConfig.nextStage, 
        userAnswers,
      });
    }

    // SEND MODEL MESSAGE: This sends the instruction to the model and gets the response
    modelResponseText = await this.#sendModelMessage(
      instructionToAI, 
      history, 
      currentStageConfig.generationConfig || {} 
    );

    let newInterviewStage = currentStageConfig.nextStage || interviewStage; 
    let newFollowUpCount = followUpCount; 

    // FOLLOW-UP COUNT LOGIC: This block updates the follow-up count based on the current interview stage
    if (interviewStage === "initial") {
      newFollowUpCount = 0; 
    } else if (interviewStage === "awaiting_first_core_question") {
      newFollowUpCount = 1; 
    } else if (interviewStage === "asking_follow_ups") {
      newFollowUpCount = followUpCount + 1; 
      if (newFollowUpCount >= currentStageConfig.maxFollowUps) {
        newInterviewStage = currentStageConfig.nextStage; 
      }
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

      // Process the interview turn with the current session data
      // The session now contains the history, interview stage, follow-up count, and user answers
      const turnArgs = {
        // Prepare the arguments for the processInterviewTurn method
        history: session.history, // Pass the chat history
        followUpCount: session.followUpCount, // Pass the current follow-up count
        interviewStage: session.interviewStage, // Pass the current interview stage
        userAnswers: session.userAnswers, // Pass the user's answers collected so far
      };
      // Call the processInterviewTurn method to get the model response and update the session
      // This method will handle the logic for the current interview stage and return the response
      const {
        modelResponseText,
        newInterviewStage,
        newFollowUpCount,
      } = // Call the processInterviewTurn method with the prepared arguments
        await this.processInterviewTurn(turnArgs); // Process the interview turn and get the model's response

      // If the model response is empty, we handle it gracefully
      if (modelResponseText) {
        // If the model response is not empty, we add it to the session history
        session.history.push({ role: "model", text: modelResponseText }); // Add the model's response to the chat history
      }

      // Update the session with the new interview stage and follow-up count
      // This ensures that the session state is maintained for the next interaction
      session.interviewStage = newInterviewStage; // Update the interview stage in the session
      session.followUpCount = newFollowUpCount; // Update the follow-up count in the session

      // Save the updated session back to chatHistories
      res.json({
        // Send the response back to the client
        response: modelResponseText, // Include the model's response in the response
        history: session.history, // Include the updated chat history
        interviewStage: newInterviewStage, // Include the updated interview stage
        followUpCount: newFollowUpCount, // Include the updated follow-up count
      });
      // ERROR HANDLING: for ChatBotController
    } catch (err) {
      console.error("Error calling ChatBotController:", err.message, err.stack); 
      res.status(500).json({ error: "Failed to process interview." }); 
    }
  }
}

module.exports = ChatBotController;
