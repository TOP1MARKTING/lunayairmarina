import type { ChatClientPayload, ChatResponse } from "@/lib/chatbot/types";
import { callServerApi } from "./client";
import { API_OPERATIONS } from "./endpoints";
import { unwrapServerFnArgs } from "./unwrap";

export type ChatbotContactPayload = {
  sessionId: string;
  language: "ar" | "en";
  name: string;
  phone: string;
  email?: string;
};

export type ChatbotContactResult =
  | { ok: true; confirmation: string }
  | { ok: false; code: "VALIDATION" | "SERVICE" };

export async function chatbotSendMessage(
  input: ChatClientPayload | { data: ChatClientPayload },
): Promise<ChatResponse> {
  const payload = unwrapServerFnArgs(input);
  return callServerApi<ChatClientPayload, ChatResponse>(API_OPERATIONS.chatbotSendMessage, {
    data: payload,
  });
}

export async function chatbotSubmitContact(
  input: ChatbotContactPayload | { data: ChatbotContactPayload },
): Promise<ChatbotContactResult> {
  const payload = unwrapServerFnArgs(input);
  return callServerApi<ChatbotContactPayload, ChatbotContactResult>(
    API_OPERATIONS.chatbotSubmitContact,
    { data: payload },
  );
}

export const sendChatbotMessage = chatbotSendMessage;
export const submitChatbotContact = chatbotSubmitContact;
