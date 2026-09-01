import { onRequest } from "firebase-functions/v2/https";
import { clearAllChatbotVisitorDataAdmin } from "../../src/server/agent/chatbotResetAdmin";
import { deleteConversationAdmin } from "../../src/server/agent/conversationStoreAdmin";
import { getAdminFirestore } from "../../src/server/agent/firebaseAdmin";
import { runKnowledgeSyncNow } from "../../src/server/agent/knowledgeSync";
import { requireActiveAdminRequest, requireSuperAdminRequest } from "./shared/adminAuth";
import { CORS_ORIGINS, HttpError } from "./shared/cors";
import { handlePostJson } from "./shared/http";

export const aiTriggerKnowledgeSync = onRequest(
  {
    cors: CORS_ORIGINS,
    timeoutSeconds: 300,
    memory: "1GiB",
  },
  handlePostJson(async (_body, req) => {
    await requireActiveAdminRequest(req);
    return runKnowledgeSyncNow("admin_dashboard");
  }),
);

export const aiDeleteConversation = onRequest(
  {
    cors: CORS_ORIGINS,
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  handlePostJson(async (body, req) => {
    await requireActiveAdminRequest(req);

    const payload = body as { sessionId?: string; leadId?: string };
    if (!payload?.sessionId?.trim()) {
      throw new HttpError(400, "sessionId required");
    }

    try {
      const db = await getAdminFirestore();
      await deleteConversationAdmin(db, payload.sessionId.trim(), payload.leadId?.trim());
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "delete_failed",
      };
    }
  }),
);

export const aiDeleteAllConversations = onRequest(
  {
    cors: CORS_ORIGINS,
    timeoutSeconds: 300,
    memory: "1GiB",
  },
  handlePostJson(async (_body, req) => {
    await requireSuperAdminRequest(req);

    try {
      const db = await getAdminFirestore();
      const result = await clearAllChatbotVisitorDataAdmin(db);
      return { ok: true as const, ...result };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "delete_failed",
      };
    }
  }),
);
