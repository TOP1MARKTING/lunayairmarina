import { useCallback, useEffect, useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";
import { Bot, MessageSquareText, Phone, RefreshCw, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DataTable, RowAction, StatusBadge, type Column } from "@/components/admin/DataTable";
import { Modal } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { getDb } from "@/lib/firebase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import {
  AI_CONVERSATIONS_COLLECTION,
  AI_MESSAGES_SUBCOLLECTION,
  KNOWLEDGE_COLLECTION,
  type AiConversationRecord,
  type AiMessageRecord,
} from "@/lib/agent/types";
import { sortMessagesChronologically } from "@/lib/agent/messageOrder";
import { readKnowledgeSyncStatusClient } from "@/lib/agent/knowledgeSyncClient";
import { triggerKnowledgeSync, deleteAiConversation, deleteAllAiConversations } from "@/lib/api/aiAdmin";
import { cn } from "@/lib/utils";

export const Route = createLazyFileRoute("/admin/ai")({
  component: AdminAiPage,
});

function visitorName(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorName || (typeof ctx.name === "string" ? ctx.name : "") || "";
}

function visitorPhone(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorPhone || (typeof ctx.phone === "string" ? ctx.phone : "") || "";
}

function whatsappHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "#";
  const normalized =
    digits.startsWith("0") && digits.length >= 10 ? `20${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}`;
}

async function listConversations(db: Firestore): Promise<AiConversationRecord[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, AI_CONVERSATIONS_COLLECTION),
        orderBy("lastMessageAt", "desc"),
        limit(80),
      ),
    );
    return snap.docs.map((item) => item.data() as AiConversationRecord);
  } catch {
    const snap = await getDocs(collection(db, AI_CONVERSATIONS_COLLECTION));
    return snap.docs
      .map((item) => item.data() as AiConversationRecord)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .slice(0, 80);
  }
}

async function listConversationMessages(
  db: Firestore,
  sessionId: string,
): Promise<AiMessageRecord[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, AI_CONVERSATIONS_COLLECTION, sessionId, AI_MESSAGES_SUBCOLLECTION),
        orderBy("timestamp", "asc"),
        limit(200),
      ),
    );
    return sortMessagesChronologically(
      snap.docs.map((item) => item.data() as AiMessageRecord),
    );
  } catch {
    const snap = await getDocs(
      collection(db, AI_CONVERSATIONS_COLLECTION, sessionId, AI_MESSAGES_SUBCOLLECTION),
    );
    return sortMessagesChronologically(
      snap.docs.map((item) => item.data() as AiMessageRecord),
    );
  }
}

async function countKnowledge(db: Firestore): Promise<number> {
  const snap = await getDocs(collection(db, KNOWLEDGE_COLLECTION));
  return snap.size;
}

function AdminAiPage() {
  const { t, language } = useLanguage();
  const { can } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [conversations, setConversations] = useState<AiConversationRecord[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [syncNeeds, setSyncNeeds] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeConversation, setActiveConversation] = useState<AiConversationRecord | null>(null);
  const [transcript, setTranscript] = useState<AiMessageRecord[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = getDb();
      const [conv, count, sync] = await Promise.all([
        listConversations(db),
        countKnowledge(db),
        readKnowledgeSyncStatusClient(db),
      ]);
      setConversations(conv);
      setKnowledgeCount(count);
      setSyncNeeds(Boolean(sync?.needsReingest));
    } catch {
      setStatus(t("admin.ai.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!can("ai")) return;
    void refresh();
  }, [can, refresh]);

  const openTranscript = useCallback(async (row: AiConversationRecord) => {
    setActiveConversation(row);
    setTranscript([]);
    setTranscriptLoading(true);
    try {
      const messages = await listConversationMessages(getDb(), row.sessionId);
      setTranscript(messages);
    } catch {
      setTranscript([]);
    } finally {
      setTranscriptLoading(false);
    }
  }, []);

  const contactsWithPhone = useMemo(
    () => conversations.filter((row) => Boolean(visitorPhone(row))),
    [conversations],
  );

  const readyFollowUp = useMemo(
    () => conversations.filter((row) => row.leadStatus === "handoff"),
    [conversations],
  );

  const conversationColumns: Column<AiConversationRecord>[] = [
    {
      key: "name",
      header: t("admin.ai.name"),
      render: (row) => (
        <span className="font-medium text-navy">{visitorName(row) || "—"}</span>
      ),
    },
    {
      key: "phone",
      header: t("admin.ai.phone"),
      render: (row) => {
        const phone = visitorPhone(row);
        if (!phone) return <span className="text-navy/40">—</span>;
        return (
          <a
            href={whatsappHref(phone)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-navy underline-offset-2 hover:text-gold hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <Phone className="size-3.5 shrink-0 text-gold" aria-hidden />
            <span dir="ltr">{phone}</span>
          </a>
        );
      },
    },
    {
      key: "lead",
      header: t("admin.ai.leadStatus"),
      render: (row) => (
        <StatusBadge
          tone={
            row.leadStatus === "handoff"
              ? "active"
              : row.leadStatus === "potential"
                ? "scheduled"
                : "draft"
          }
          label={
            row.leadStatus === "handoff"
              ? t("admin.ai.leadHandoff")
              : row.leadStatus === "potential"
                ? t("admin.ai.leadPotential")
                : t("admin.ai.leadNone")
          }
        />
      ),
    },
    {
      key: "lang",
      header: t("admin.ai.language"),
      render: (row) => row.language.toUpperCase(),
    },
    {
      key: "updated",
      header: t("admin.ai.updated"),
      render: (row) => new Date(row.lastMessageAt).toLocaleString(language === "ar" ? "ar" : "en"),
    },
  ];

  async function onDeleteConversation(row: AiConversationRecord) {
    setDeletingId(row.sessionId);
    setStatus("");
    try {
      const result = await deleteAiConversation({
        data: { sessionId: row.sessionId, leadId: row.leadId },
      });
      if (result.ok) {
        setConversations((prev) => prev.filter((item) => item.sessionId !== row.sessionId));
        if (activeConversation?.sessionId === row.sessionId) {
          setActiveConversation(null);
          setTranscript([]);
        }
        setStatus(t("admin.ai.deleteSuccess"));
      } else {
        setStatus(result.error || t("admin.ai.deleteFailed"));
      }
    } catch {
      setStatus(t("admin.ai.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  async function onDeleteAllConversations() {
    setClearingAll(true);
    setStatus("");
    try {
      const result = await deleteAllAiConversations();
      if (result.ok) {
        setConversations([]);
        setActiveConversation(null);
        setTranscript([]);
        setStatus(
          language === "ar"
            ? `تم مسح ${result.conversations ?? 0} محادثة و${result.leads ?? 0} ليد — كل الزوار سيسجّلون من جديد`
            : `Cleared ${result.conversations ?? 0} conversations and ${result.leads ?? 0} leads — all visitors must register again`,
        );
      } else {
        setStatus(result.error || t("admin.ai.deleteFailed"));
      }
    } catch {
      setStatus(t("admin.ai.deleteFailed"));
    } finally {
      setClearingAll(false);
    }
  }

  async function onSync() {
    setSyncing(true);
    setStatus("");
    try {
      const result = await triggerKnowledgeSync();
      if (result.ok) {
        setStatus(
          language === "ar"
            ? `تمت المزامنة — ${result.total ?? 0} مستند`
            : `Synced — ${result.total ?? 0} documents`,
        );
      } else {
        setStatus(result.error || t("admin.ai.syncFailed"));
      }
      await refresh();
    } catch {
      setStatus(t("admin.ai.syncFailed"));
    } finally {
      setSyncing(false);
    }
  }

  if (!can("ai")) {
    return (
      <AdminLayout title={t("admin.nav.ai")}>
        <p className="text-sm text-muted-foreground">{t("admin.ai.noPermission")}</p>
      </AdminLayout>
    );
  }

  const activePhone = activeConversation ? visitorPhone(activeConversation) : "";
  const activeName = activeConversation ? visitorName(activeConversation) : "";

  return (
    <AdminLayout title={t("admin.nav.ai")}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("admin.ai.subtitle")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-xl border border-navy/15 bg-white px-4 py-2 text-sm text-navy"
          >
            <RefreshCw className="size-4" />
            {t("admin.ai.refresh")}
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void onSync()}
            className="inline-flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            <Bot className="size-4" />
            {syncing ? t("admin.ai.syncing") : t("admin.ai.syncNow")}
          </button>
        </div>
      </div>

      {status ? <p className="mb-4 text-sm text-navy/80">{status}</p> : null}
      {loading ? <p className="mb-4 text-xs text-navy/55">{t("admin.ai.loading")}</p> : null}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("admin.ai.contactsWithPhone")} value={String(contactsWithPhone.length)} />
        <StatCard label={t("admin.ai.conversations")} value={String(conversations.length)} />
        <StatCard label={t("admin.ai.readyFollowUp")} value={String(readyFollowUp.length)} />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-display text-lg text-navy">{t("admin.ai.conversations")}</h3>
            <p className="mt-0.5 text-xs text-navy/50">{t("admin.ai.conversationsHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-navy/45">
              {t("admin.ai.knowledgeDocs")}: {knowledgeCount}
              {syncNeeds ? ` · ${t("admin.ai.syncNeeded")}` : ""}
            </p>
            {conversations.length > 0 ? (
              <button
                type="button"
                disabled={clearingAll || deletingId !== null}
                onClick={() => {
                  if (!window.confirm(t("admin.ai.deleteAllConfirm"))) return;
                  void onDeleteAllConversations();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-60"
              >
                <Trash2 className="size-3.5" aria-hidden />
                {clearingAll ? t("admin.ai.deletingAll") : t("admin.ai.deleteAll")}
              </button>
            ) : (
              <button
                type="button"
                disabled={clearingAll || deletingId !== null}
                onClick={() => {
                  if (!window.confirm(t("admin.ai.resetAllVisitorsConfirm"))) return;
                  void onDeleteAllConversations();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-60"
              >
                <Trash2 className="size-3.5" aria-hidden />
                {clearingAll ? t("admin.ai.deletingAll") : t("admin.ai.resetAllVisitors")}
              </button>
            )}
          </div>
        </div>
        <DataTable
          columns={conversationColumns}
          rows={conversations}
          getRowId={(row) => row.conversationId}
          actions={(row) => (
            <>
              <RowAction
                icon={MessageSquareText}
                label={t("admin.ai.viewChat")}
                onClick={() => void openTranscript(row)}
              />
              <RowAction
                icon={Trash2}
                label={t("admin.ai.deleteConversation")}
                tone="danger"
                confirmMessage={t("admin.ai.deleteConversationConfirm")}
                onClick={() => void onDeleteConversation(row)}
              />
            </>
          )}
        />
      </section>

      <Modal
        open={Boolean(activeConversation)}
        title={t("admin.ai.chatTranscript")}
        onClose={() => {
          setActiveConversation(null);
          setTranscript([]);
        }}
        size="lg"
      >
        {activeConversation ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-navy/10 bg-sand/40 px-3 py-3 text-sm text-navy">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {activeName || t("admin.ai.visitor")}
                    {activePhone ? (
                      <span className="ms-2 font-normal text-navy/70" dir="ltr">
                        {activePhone}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 font-mono text-[0.65rem] text-navy/45">
                    {activeConversation.sessionId}
                  </p>
                </div>
                {activePhone ? (
                  <a
                    href={whatsappHref(activePhone)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-1.5 text-xs font-medium text-navy hover:bg-gold/25"
                  >
                    <Phone className="size-3.5" aria-hidden />
                    WhatsApp
                  </a>
                ) : null}
              </div>
              {activeConversation.summary ? (
                <p className="mt-2 text-xs leading-relaxed text-navy/70">
                  {activeConversation.summary}
                </p>
              ) : null}
            </div>
            {transcriptLoading ? (
              <p className="text-sm text-muted-foreground">{t("admin.ai.loading")}</p>
            ) : transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.ai.emptyTranscript")}</p>
            ) : (
              <div className="max-h-[min(28rem,60vh)] space-y-1 overflow-y-auto pe-1">
                <p className="mb-3 text-[0.65rem] text-navy/45">{t("admin.ai.transcriptOrderHint")}</p>
                <ul className="space-y-3">
                  {transcript.map((message, index) => {
                    const isUser = message.role === "user";
                    const prev = transcript[index - 1];
                    const showDayDivider =
                      !prev ||
                      new Date(prev.timestamp).toDateString() !==
                        new Date(message.timestamp).toDateString();
                    return (
                      <li key={message.id} className="space-y-2">
                        {showDayDivider ? (
                          <p className="py-1 text-center text-[0.65rem] tracking-wide text-navy/40">
                            {new Date(message.timestamp).toLocaleDateString(
                              language === "ar" ? "ar" : "en",
                              { weekday: "short", day: "numeric", month: "short" },
                            )}
                          </p>
                        ) : null}
                        <div
                          className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "max-w-[92%] rounded-2xl border px-3 py-2.5 text-sm leading-relaxed shadow-sm",
                              isUser
                                ? "rounded-ee-md border-navy/15 bg-navy text-navy-foreground"
                                : "rounded-es-md border-navy/10 bg-white text-navy",
                            )}
                          >
                            <p className="mb-1 text-[0.65rem] tracking-wide uppercase opacity-60">
                              {isUser ? t("admin.ai.roleUser") : t("admin.ai.roleAssistant")}
                            </p>
                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {message.content}
                            </p>
                            <time className="mt-2 block text-[0.65rem] opacity-50" dir="ltr">
                              {new Date(message.timestamp).toLocaleTimeString(
                                language === "ar" ? "ar" : "en",
                                { hour: "2-digit", minute: "2-digit", second: "2-digit" },
                              )}
                            </time>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </AdminLayout>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-navy/10 bg-white px-4 py-3">
      <p className="text-[0.65rem] tracking-[0.16em] text-navy/45 uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl text-navy">{value}</p>
    </div>
  );
}
