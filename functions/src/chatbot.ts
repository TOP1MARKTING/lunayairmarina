import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { processChatMessage } from "../../src/server/chatbot/chat";
import { saveChatContact } from "../../src/server/chatbot/saveContact";
import { CORS_ORIGINS } from "./shared/cors";
import { handlePostJson } from "./shared/http";

export const geminiApiKey = defineSecret("GEMINI_API_KEY");

export const chatbotSendMessage = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  handlePostJson(async (body) => processChatMessage(body)),
);

export const chatbotSubmitContact = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [geminiApiKey],
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  handlePostJson(async (body) => saveChatContact(body)),
);
