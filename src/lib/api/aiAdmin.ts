import { callServerApi } from "./client";
import { API_OPERATIONS } from "./endpoints";
import { getAdminIdToken } from "./authHeaders";
import { unwrapServerFnArgs } from "./unwrap";

/**
 * Admin identity travels in the body as well as the Bearer header: the
 * server-fn transport has no header channel, while Cloud Functions read the
 * header and ignore the extra field.
 */
type AdminTokenPayload = { idToken: string };

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
  const idToken = await getAdminIdToken();
  return callServerApi<AdminTokenPayload, KnowledgeSyncResult>(
    API_OPERATIONS.aiTriggerKnowledgeSync,
    { data: { idToken }, headers: { Authorization: `Bearer ${idToken}` } },
  );
}

export async function aiDeleteConversation(
  input: DeleteConversationPayload | { data: DeleteConversationPayload },
): Promise<DeleteConversationResult> {
  const payload = unwrapServerFnArgs(input);
  const idToken = await getAdminIdToken();
  return callServerApi<AdminTokenPayload & DeleteConversationPayload, DeleteConversationResult>(
    API_OPERATIONS.aiDeleteConversation,
    { data: { ...payload, idToken }, headers: { Authorization: `Bearer ${idToken}` } },
  );
}

export async function aiDeleteAllConversations(): Promise<DeleteAllConversationsResult> {
  const idToken = await getAdminIdToken();
  return callServerApi<AdminTokenPayload, DeleteAllConversationsResult>(
    API_OPERATIONS.aiDeleteAllConversations,
    { data: { idToken }, headers: { Authorization: `Bearer ${idToken}` } },
  );
}

export const triggerKnowledgeSync = aiTriggerKnowledgeSync;
export const deleteAiConversation = aiDeleteConversation;
export const deleteAllAiConversations = aiDeleteAllConversations;
