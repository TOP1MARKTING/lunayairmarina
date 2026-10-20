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
import {
  Bot,
  Check,
  Download,
  MessageSquareText,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ChatbotWeeklyReportPanel } from "@/components/admin/ChatbotWeeklyReport";
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
  type AiLeadRecord,
  type AiLeadStatus,
  type AiMessageRecord,
} from "@/lib/agent/types";
import { sortMessagesChronologically } from "@/lib/agent/messageOrder";
import { readKnowledgeSyncStatusClient } from "@/lib/agent/knowledgeSyncClient";
import {
  listAiLeadsClient,
  updateAiLeadStatusClient,
} from "@/lib/agent/aiAdminClient";
import { triggerKnowledgeSync, deleteAiConversation, deleteAllAiConversations } from "@/lib/api/aiAdmin";
import { cn } from "@/lib/utils";

export const Route = createLazyFileRoute("/admin/ai")({
  component: AdminAiPage,
});

type AiTab = "conversations" | "leads";
type LeadFilter = "all" | "handoff" | "potential" | "none";

function visitorName(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorName || (typeof ctx.name === "string" ? ctx.name : "") || "";
}

function visitorPhone(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorPhone || (typeof ctx.phone === "string" ? ctx.phone : "") || "";
}

function visitorEmail(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorEmail || (typeof ctx.email === "string" ? ctx.email : "") || "";
}

function whatsappHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "#";
  let normalized = digits;
  if (normalized.startsWith("00")) normalized = normalized.slice(2);
  if (normalized.startsWith("966")) {
    // already international
  } else if (normalized.startsWith("0") && normalized.length >= 10) {
    normalized = `966${normalized.slice(1)}`;
  } else if (normalized.length === 9 && normalized.startsWith("5")) {
    normalized = `966${normalized}`;
  }
  return `https://wa.me/${normalized}`;
}

function csvEscape(value: string): string {
  const text = value.replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  const { t, language, isRTL } = useLanguage();
  const { can } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<AiTab>("conversations");
  const [conversations, setConversations] = useState<AiConversationRecord[]>([]);
  const [leads, setLeads] = useState<AiLeadRecord[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [syncNeeds, setSyncNeeds] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeConversation, setActiveConversation] = useState<AiConversationRecord | null>(null);
  const [transcript, setTranscript] = useState<AiMessageRecord[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [search, setSearch] = useState("");
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = getDb();
      const [conv, count, sync, leadRows] = await Promise.all([
        listConversations(db),
        countKnowledge(db),
        readKnowledgeSyncStatusClient(db),
        listAiLeadsClient(db, 100),
      ]);
      setConversations(conv);
      setKnowledgeCount(count);
      setSyncNeeds(Boolean(sync?.needsReingest));
      setLeads(leadRows);
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

  const openTranscriptByConversationId = useCallback(
    async (conversationId: string) => {
      const row = conversations.find(
        (item) => item.conversationId === conversationId || item.sessionId === conversationId,
      );
      if (row) {
        await openTranscript(row);
        return;
      }
      setActiveConversation({
        conversationId,
        sessionId: conversationId,
        language: language === "ar" ? "ar" : "en",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        summary: "",
        customerContext: {},
        status: "active",
        leadStatus: "none",
      });
      setTranscript([]);
      setTranscriptLoading(true);
      try {
        const messages = await listConversationMessages(getDb(), conversationId);
        setTranscript(messages);
      } catch {
        setTranscript([]);
      } finally {
        setTranscriptLoading(false);
      }
    },
    [conversations, language, openTranscript],
  );

  const contactsWithPhone = useMemo(
    () => conversations.filter((row) => Boolean(visitorPhone(row))),
    [conversations],
  );

  const readyFollowUp = useMemo(
    () => conversations.filter((row) => row.leadStatus === "handoff"),
    [conversations],
  );

  const newLeads = useMemo(() => leads.filter((row) => row.status === "new"), [leads]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((row) => {
      if (leadFilter !== "all" && row.leadStatus !== leadFilter) return false;
      if (!q) return true;
      const haystack = [
        visitorName(row),
        visitorPhone(row),
        visitorEmail(row),
        row.lastIntent ?? "",
        row.summary ?? "",
        row.sessionId,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [conversations, leadFilter, search]);

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
      key: "intent",
      header: t("admin.ai.intent"),
      render: (row) => (
        <span className="text-navy/70">{row.lastIntent || "—"}</span>
      ),
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

  const leadColumns: Column<AiLeadRecord>[] = [
    {
      key: "name",
      header: t("admin.ai.name"),
      render: (row) => <span className="font-medium text-navy">{row.name || "—"}</span>,
    },
    {
      key: "phone",
      header: t("admin.ai.phone"),
      render: (row) => {
        if (!row.phone) return <span className="text-navy/40">—</span>;
        return (
          <a
            href={whatsappHref(row.phone)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-navy underline-offset-2 hover:text-gold hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <Phone className="size-3.5 shrink-0 text-gold" aria-hidden />
            <span dir="ltr">{row.phone}</span>
          </a>
        );
      },
    },
    {
      key: "email",
      header: t("admin.ai.email"),
      render: (row) => row.email || "—",
    },
    {
      key: "interest",
      header: t("admin.ai.interest"),
      render: (row) =>
        row.serviceInterest?.length ? row.serviceInterest.slice(0, 3).join(", ") : "—",
    },
    {
      key: "score",
      header: t("admin.ai.leadScore"),
      render: (row) => String(row.leadScore ?? 0),
    },
    {
      key: "status",
      header: t("admin.ai.crmStatus"),
      render: (row) => (
        <StatusBadge
          tone={
            row.status === "new" ? "scheduled" : row.status === "contacted" ? "active" : "paused"
          }
          label={
            row.status === "new"
              ? t("admin.ai.leadCrmNew")
              : row.status === "contacted"
                ? t("admin.ai.leadCrmContacted")
                : t("admin.ai.leadCrmClosed")
          }
        />
      ),
    },
    {
      key: "created",
      header: t("admin.ai.updated"),
      render: (row) =>
        new Date(row.lastSeenAt || row.createdAt).toLocaleString(language === "ar" ? "ar" : "en"),
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
        setLeads([]);
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

  async function onUpdateLeadStatus(row: AiLeadRecord, next: AiLeadStatus) {
    setUpdatingLeadId(row.id);
    setStatus("");
    try {
      await updateAiLeadStatusClient(getDb(), row.id, next);
      setLeads((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? { ...item, status: next, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
      setStatus(
        next === "closed"
          ? t("admin.ai.leadClosed")
          : next === "contacted"
            ? t("admin.ai.leadMarkedContacted")
            : t("admin.ai.leadMarkedNew"),
      );
    } catch {
      setStatus(t("admin.ai.leadUpdateFailed"));
    } finally {
      setUpdatingLeadId(null);
    }
  }

  function exportLeadsCsv() {
    const source = leads.length
      ? leads
      : conversations
          .filter((row) => visitorPhone(row) || visitorName(row))
          .map((row) => ({
            id: row.sessionId,
            name: visitorName(row),
            phone: visitorPhone(row),
            email: visitorEmail(row),
            yachtType: "",
            yachtLength: "",
            location: "",
            serviceInterest: row.lastIntent ? [row.lastIntent] : [],
            conversationId: row.sessionId,
            source: "chatbot" as const,
            status: "new" as const,
            createdAt: row.lastMessageAt,
            leadScore: 0,
          }));

    downloadCsv(
      `lunayair-ai-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        t("admin.ai.name"),
        t("admin.ai.phone"),
        t("admin.ai.email"),
        t("admin.ai.interest"),
        t("admin.ai.leadScore"),
        t("admin.ai.crmStatus"),
        t("admin.ai.updated"),
      ],
      source.map((row) => [
        row.name,
        row.phone,
        row.email,
        Array.isArray(row.serviceInterest) ? row.serviceInterest.join(" | ") : "",
        String(row.leadScore ?? 0),
        row.status,
        row.createdAt,
      ]),
    );
    setStatus(t("admin.ai.exportDone"));
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

  const tabs: { id: AiTab; label: string; count: number }[] = [
    { id: "conversations", label: t("admin.ai.conversations"), count: conversations.length },
    { id: "leads", label: t("admin.ai.leads"), count: leads.length || contactsWithPhone.length },
  ];

  return (
    <AdminLayout title={t("admin.nav.ai")}>
      <ChatbotWeeklyReportPanel className="mb-6 mt-0" showOpenAiLink={false} />

      <div className="rounded-[1.5rem] border border-navy/8 bg-white/90 p-4 shadow-[0_10px_40px_rgba(15,23,42,0.04)] sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-navy/60">{t("admin.ai.subtitle")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-xl border border-navy/10 bg-sand px-4 py-2 text-sm text-navy transition hover:border-gold/40 hover:bg-white"
          >
            <RefreshCw className="size-4" />
            {t("admin.ai.refresh")}
          </button>
          <button
            type="button"
            onClick={exportLeadsCsv}
            className="inline-flex items-center gap-2 rounded-xl border border-navy/10 bg-sand px-4 py-2 text-sm text-navy transition hover:border-gold/40 hover:bg-white"
          >
            <Download className="size-4" />
            {t("admin.ai.exportLeads")}
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void onSync()}
            className="inline-flex items-center gap-2 rounded-xl border border-gold/45 bg-gold/20 px-4 py-2 text-sm font-medium text-navy transition hover:bg-gold/30 disabled:opacity-60"
          >
            <Bot className="size-4" />
            {syncing ? t("admin.ai.syncing") : t("admin.ai.syncNow")}
          </button>
        </div>
      </div>

      {status ? <p className="mb-4 text-sm text-navy/80">{status}</p> : null}
      {loading ? <p className="mb-4 text-xs text-navy/55">{t("admin.ai.loading")}</p> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <StatCard label={t("admin.ai.contactsWithPhone")} value={String(contactsWithPhone.length)} />
        <StatCard label={t("admin.ai.conversations")} value={String(conversations.length)} />
        <StatCard label={t("admin.ai.readyFollowUp")} value={String(readyFollowUp.length)} />
        <StatCard label={t("admin.ai.newLeads")} value={String(newLeads.length)} />
        <StatCard
          label={t("admin.ai.syncStatus")}
          value={syncNeeds ? t("admin.ai.syncNeeded") : t("admin.ai.syncOk")}
          hint={`${t("admin.ai.knowledgeDocs")}: ${knowledgeCount}`}
        />
      </div>

      <div
        className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-navy/8 bg-sand p-1.5"
        role="tablist"
        aria-label={t("admin.nav.ai")}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition",
              tab === item.id
                ? "border border-gold/40 bg-white text-navy shadow-sm"
                : "border border-transparent text-navy/65 hover:bg-white/70 hover:text-navy",
            )}
          >
            {item.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium",
                tab === item.id ? "bg-gold/25 text-navy" : "bg-white text-navy/55",
              )}
            >
              {item.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "conversations" ? (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-navy">{t("admin.ai.conversations")}</h3>
              <p className="mt-0.5 text-xs text-navy/50">{t("admin.ai.conversationsHint")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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

          <div className="mb-4 flex flex-wrap gap-2">
            <label className="relative min-w-[14rem] flex-1">
              <Search
                className={cn(
                  "pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-navy/35",
                  isRTL ? "right-3" : "left-3",
                )}
                aria-hidden
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("admin.ai.searchPlaceholder")}
                className={cn(
                  "w-full rounded-xl border border-navy/12 bg-white py-2.5 text-sm text-navy outline-none focus:border-gold/50 focus:ring-2 focus:ring-gold/20",
                  isRTL ? "pr-10 pl-3" : "pl-10 pr-3",
                )}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", t("admin.ai.filterAll")],
                  ["handoff", t("admin.ai.leadHandoff")],
                  ["potential", t("admin.ai.leadPotential")],
                  ["none", t("admin.ai.leadNone")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLeadFilter(id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    leadFilter === id
                      ? "border-gold/50 bg-gold/20 font-medium text-navy"
                      : "border-navy/10 bg-white text-navy/65 hover:border-gold/35 hover:bg-sand",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredConversations.length === 0 && !loading ? (
            <p className="rounded-2xl border border-dashed border-navy/15 bg-white px-4 py-10 text-center text-sm text-navy/50">
              {t("admin.ai.emptyConversations")}
            </p>
          ) : (
            <DataTable
              columns={conversationColumns}
              rows={filteredConversations}
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
          )}
        </section>
      ) : null}

      {tab === "leads" ? (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-display text-lg text-navy">{t("admin.ai.leads")}</h3>
              <p className="mt-0.5 text-xs text-navy/50">{t("admin.ai.leadsHint")}</p>
            </div>
            <button
              type="button"
              onClick={exportLeadsCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-navy/12 bg-white px-3 py-1.5 text-xs text-navy"
            >
              <Download className="size-3.5" aria-hidden />
              {t("admin.ai.exportLeads")}
            </button>
          </div>

          {leads.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-navy/15 bg-white px-4 py-10 text-center text-sm text-navy/50">
              {t("admin.ai.emptyLeads")}
            </p>
          ) : (
            <DataTable
              columns={leadColumns}
              rows={leads}
              getRowId={(row) => row.id}
              actions={(row) => (
                <>
                  <RowAction
                    icon={MessageSquareText}
                    label={t("admin.ai.viewChat")}
                    onClick={() => void openTranscriptByConversationId(row.conversationId)}
                  />
                  {row.status === "new" ? (
                    <RowAction
                      icon={UserRound}
                      label={t("admin.ai.markContacted")}
                      onClick={() => void onUpdateLeadStatus(row, "contacted")}
                    />
                  ) : null}
                  {row.status !== "closed" ? (
                    <RowAction
                      icon={Check}
                      label={t("admin.ai.closeLead")}
                      onClick={() => {
                        if (updatingLeadId) return;
                        void onUpdateLeadStatus(row, "closed");
                      }}
                    />
                  ) : null}
                </>
              )}
            />
          )}
        </section>
      ) : null}

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
                                ? "rounded-ee-md border-gold/35 bg-gold/15 text-navy"
                                : "rounded-es-md border-navy/8 bg-sand text-navy",
                            )}
                          >
                            <p className="mb-1 text-[0.65rem] tracking-wide text-navy/45 uppercase">
                              {isUser ? t("admin.ai.roleUser") : t("admin.ai.roleAssistant")}
                            </p>
                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {message.content}
                            </p>
                            <time className="mt-2 block text-[0.65rem] text-navy/40" dir="ltr">
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
      </div>
    </AdminLayout>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-navy/8 bg-sand px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <p className="text-[0.65rem] tracking-[0.16em] text-navy/40 uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl text-navy">{value}</p>
      {hint ? <p className="mt-1 text-[0.65rem] text-navy/45">{hint}</p> : null}
    </div>
  );
}
