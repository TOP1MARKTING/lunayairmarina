import type { ChatHistoryItem } from "@/lib/chatbot/types";
import type { AiMessageRecord } from "@/lib/agent/types";
import { getClientFirestoreFallback } from "@/server/agent/clientFirestore";
import { listConversationMessages } from "@/server/agent/conversationStore";
import { listConversationMessagesAdmin } from "@/server/agent/conversationStoreAdmin";
import { tryGetAdminFirestore } from "@/server/agent/firebaseAdmin";

export function messagesToHistory(messages: AiMessageRecord[]): ChatHistoryItem[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content.trim().slice(0, 4000),
    }))
    .filter((message) => message.content.length > 0);
}

/**
 * Authoritative conversation history for AI context. Prefer Firestore messages
 * (full persisted thread) over client-sent history (legacy / first-turn fallback).
 */
export async function resolveConversationHistory(
  sessionId: string,
  clientHistory: ChatHistoryItem[],
): Promise<{ history: ChatHistoryItem[]; source: "firestore" | "client" }> {
  try {
    const adminDb = await tryGetAdminFirestore();
    if (adminDb) {
      const adminMessages = await listConversationMessagesAdmin(adminDb, sessionId);
      const fromAdmin = messagesToHistory(adminMessages);
      if (fromAdmin.length > 0) return { history: fromAdmin, source: "firestore" };
    }

    const clientMessages = await listConversationMessages(getClientFirestoreFallback(), sessionId);
    const fromClient = messagesToHistory(clientMessages);
    if (fromClient.length > 0) return { history: fromClient, source: "firestore" };
  } catch {
    // Firestore read failure — fall back to client history.
  }

  return { history: clientHistory, source: "client" };
}
