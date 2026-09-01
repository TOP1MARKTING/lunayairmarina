import { createServerFn } from "@tanstack/react-start";
import { clearAllChatbotVisitorDataAdmin } from "@/server/agent/chatbotResetAdmin";
import {
  deleteConversationAdmin,
} from "@/server/agent/conversationStoreAdmin";
import { getAdminFirestore } from "@/server/agent/firebaseAdmin";
import { runKnowledgeSyncNow } from "@/server/agent/knowledgeSync";
import { requireActiveAdminFromToken } from "@/server/admin/requireActiveAdmin";
import { requireSuperAdminFromToken } from "@/server/admin/requireSuperAdmin";

type AuthFailure = { ok: false; error: string };

function readIdToken(data: unknown): string {
  return (data as { idToken?: string } | null)?.idToken?.trim() ?? "";
}

function denied(error: unknown): AuthFailure {
  return { ok: false, error: error instanceof Error ? error.message : "UNAUTHORIZED" };
}

async function denyUnlessActiveAdmin(idToken: string): Promise<AuthFailure | null> {
  try {
    await requireActiveAdminFromToken(idToken);
    return null;
  } catch (error) {
    return denied(error);
  }
}

async function denyUnlessSuperAdmin(idToken: string): Promise<AuthFailure | null> {
  try {
    await requireSuperAdminFromToken(idToken);
    return null;
  } catch (error) {
    return denied(error);
  }
}

export const triggerKnowledgeSync = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ idToken: readIdToken(data) }))
  .handler(async ({ data }) => {
    const failure = await denyUnlessActiveAdmin(data.idToken);
    if (failure) return failure;
    return runKnowledgeSyncNow("admin_dashboard");
  });

export const deleteAiConversation = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const payload = data as { sessionId?: string; leadId?: string };
    if (!payload?.sessionId?.trim()) throw new Error("sessionId required");
    return {
      sessionId: payload.sessionId.trim(),
      leadId: payload.leadId?.trim(),
      idToken: readIdToken(data),
    };
  })
  .handler(async ({ data }) => {
    const failure = await denyUnlessActiveAdmin(data.idToken);
    if (failure) return failure;
    try {
      const db = await getAdminFirestore();
      await deleteConversationAdmin(db, data.sessionId, data.leadId);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "delete_failed",
      };
    }
  });

export const deleteAllAiConversations = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ idToken: readIdToken(data) }))
  .handler(async ({ data }) => {
    const failure = await denyUnlessSuperAdmin(data.idToken);
    if (failure) return failure;
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
  });
