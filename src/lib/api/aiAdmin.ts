import { callServerApi } from "./client";
import { API_OPERATIONS } from "./endpoints";
import { mergeAdminAuthHeaders } from "./authHeaders";
import { unwrapServerFnArgs } from "./unwrap";

export type DeleteConversationPayload = {
  sessionId: string;
  leadId?: string;
};

export type DeleteConversationResult = { ok: true } | { ok: false; error: string };

export type DeleteAllConversationsResult =
  | { ok: true; conversations?: number; leads?: number; identityResetEpoch?: number }
  | { ok: false; error: string };

export type KnowledgeSyncResult = {
  ok: boolean;
  total?: number;
  error?: string;
};

export async function aiTriggerKnowledgeSync(): Promise<KnowledgeSyncResult> {
  const headers = await mergeAdminAuthHeaders();
  return callServerApi<Record<string, never>, KnowledgeSyncResult>(
    API_OPERATIONS.aiTriggerKnowledgeSync,
    { data: {}, headers },
  );
}

export async function aiDeleteConversation(
  input: DeleteConversationPayload | { data: DeleteConversationPayload },
): Promise<DeleteConversationResult> {
  const payload = unwrapServerFnArgs(input);
  const headers = await mergeAdminAuthHeaders();
  return callServerApi<DeleteConversationPayload, DeleteConversationResult>(
    API_OPERATIONS.aiDeleteConversation,
    { data: payload, headers },
  );
}

export async function aiDeleteAllConversations(): Promise<DeleteAllConversationsResult> {
  const headers = await mergeAdminAuthHeaders();
  return callServerApi<Record<string, never>, DeleteAllConversationsResult>(
    API_OPERATIONS.aiDeleteAllConversations,
    { data: {}, headers },
  );
}

export const triggerKnowledgeSync = aiTriggerKnowledgeSync;
export const deleteAiConversation = aiDeleteConversation;
export const deleteAllAiConversations = aiDeleteAllConversations;
