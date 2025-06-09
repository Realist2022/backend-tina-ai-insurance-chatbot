// backend/controllers/chatController.js

const chatbotService = require("../services/ChatBotService"); // Adjust the path accordingly

// MAIN HANDLER for the chat bot controller
async function processChatRequest(req, res) {
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
    let session = chatbotService.chatHistories.get(sessionId);
    if (!session) {
      session = {
        history: [],
        interviewStage: "initial",
        followUpCount: 0,
        userAnswers: [],
      };
      chatbotService.chatHistories.set(sessionId, session);
    }

    // USER RESPONSE HANDLING: Process the user response and update the session
    if (userResponse !== "start interview") {
      session.history.push({ role: "user", text: userResponse });
      if (
        !chatbotService.constructor.STAGES_TO_EXCLUDE_USER_ANSWERS.includes(
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
      userResponse: userResponse,
    };

    // PROCESS INTERVIEW TURN: Call the processInterviewTurn method with the prepared arguments
    const { modelResponseText, newInterviewStage, newFollowUpCount } =
      await chatbotService.processInterviewTurn(turnArgs);

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
  } catch (err) {
    console.error("Error processing chat request:", err.message, err.stack);
    res.status(500).json({ error: "Failed to process interview." });
  }
}

module.exports = {
  processChatRequest,
};
