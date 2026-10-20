import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";
import {
  AI_CONVERSATIONS_COLLECTION,
  AI_LEADS_COLLECTION,
  AI_USAGE_LOGS_COLLECTION,
  type AiConversationRecord,
  type AiLeadRecord,
} from "@/lib/agent/types";

export type ReportVerdict = "good" | "ok" | "weak";

export interface PeriodStats {
  conversations: number;
  withPhone: number;
  handoff: number;
  potential: number;
  newLeads: number;
  contactedLeads: number;
  closedLeads: number;
  messagesApprox: number;
  handoffsLogged: number;
  ctasLogged: number;
  errorsLogged: number;
  arSessions: number;
  enSessions: number;
  topIntents: { intent: string; count: number }[];
  conversionRate: number;
}

export interface ChatbotWeeklyReport {
  generatedAt: string;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  current: PeriodStats;
  previous: PeriodStats;
  verdict: ReportVerdict;
  score: number;
  deltas: {
    conversations: number;
    withPhone: number;
    handoff: number;
    newLeads: number;
    conversionRate: number;
  };
  recentContacts: {
    name: string;
    phone: string;
    intent: string;
    leadStatus: string;
    at: string;
  }[];
}

interface UsageLogRow {
  event?: string;
  sessionId?: string;
  intent?: string;
  createdAt?: string;
  language?: string;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysAgo(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

function inRange(iso: string | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function visitorName(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorName || (typeof ctx.name === "string" ? ctx.name : "") || "";
}

function visitorPhone(row: AiConversationRecord): string {
  const ctx = row.customerContext ?? {};
  return row.visitorPhone || (typeof ctx.phone === "string" ? ctx.phone : "") || "";
}

function messageCount(row: AiConversationRecord): number {
  const ctx = row.customerContext ?? {};
  const n = typeof ctx.messageCount === "number" ? ctx.messageCount : 0;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function emptyStats(): PeriodStats {
  return {
    conversations: 0,
    withPhone: 0,
    handoff: 0,
    potential: 0,
    newLeads: 0,
    contactedLeads: 0,
    closedLeads: 0,
    messagesApprox: 0,
    handoffsLogged: 0,
    ctasLogged: 0,
    errorsLogged: 0,
    arSessions: 0,
    enSessions: 0,
    topIntents: [],
    conversionRate: 0,
  };
}

function buildPeriodStats(
  conversations: AiConversationRecord[],
  leads: AiLeadRecord[],
  logs: UsageLogRow[],
  start: Date,
  end: Date,
): PeriodStats {
  const periodConv = conversations.filter((row) =>
    inRange(row.lastMessageAt || row.startedAt, start, end),
  );
  const periodLeads = leads.filter((row) =>
    inRange(row.lastSeenAt || row.createdAt, start, end),
  );
  const periodLogs = logs.filter((row) => inRange(row.createdAt, start, end));

  const intentMap = new Map<string, number>();
  let withPhone = 0;
  let handoff = 0;
  let potential = 0;
  let messagesApprox = 0;
  let arSessions = 0;
  let enSessions = 0;

  for (const row of periodConv) {
    if (visitorPhone(row)) withPhone += 1;
    if (row.leadStatus === "handoff") handoff += 1;
    if (row.leadStatus === "potential") potential += 1;
    messagesApprox += Math.max(1, messageCount(row));
    if (row.language === "ar") arSessions += 1;
    if (row.language === "en") enSessions += 1;
    const intent = (row.lastIntent || "").trim();
    if (intent) intentMap.set(intent, (intentMap.get(intent) ?? 0) + 1);
  }

  for (const log of periodLogs) {
    const intent = (log.intent || "").trim();
    if (intent) intentMap.set(intent, (intentMap.get(intent) ?? 0) + 1);
  }

  const topIntents = [...intentMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([intent, count]) => ({ intent, count }));

  const conversationsCount = periodConv.length;
  const conversionRate =
    conversationsCount > 0 ? Math.round((withPhone / conversationsCount) * 100) : 0;

  return {
    conversations: conversationsCount,
    withPhone,
    handoff,
    potential,
    newLeads: periodLeads.filter((row) => row.status === "new").length,
    contactedLeads: periodLeads.filter((row) => row.status === "contacted").length,
    closedLeads: periodLeads.filter((row) => row.status === "closed").length,
    messagesApprox,
    handoffsLogged: periodLogs.filter((row) => row.event === "handoff_triggered").length,
    ctasLogged: periodLogs.filter((row) => row.event === "cta_shown").length,
    errorsLogged: periodLogs.filter((row) => row.event === "chat_error").length,
    arSessions,
    enSessions,
    topIntents,
    conversionRate,
  };
}

function scorePeriod(stats: PeriodStats): number {
  let score = 40;
  score += Math.min(25, stats.withPhone * 3);
  score += Math.min(20, stats.handoff * 5 + stats.potential * 2);
  score += Math.min(15, Math.round(stats.conversionRate / 5));
  if (stats.conversations >= 10) score += 5;
  if (stats.errorsLogged > Math.max(3, stats.conversations * 0.25)) score -= 12;
  if (stats.conversations === 0) score = 20;
  return Math.max(0, Math.min(100, score));
}

function verdictFrom(current: PeriodStats, previous: PeriodStats, score: number): ReportVerdict {
  const convDelta = current.conversations - previous.conversations;
  const phoneDelta = current.withPhone - previous.withPhone;
  const handoffDelta = current.handoff - previous.handoff;

  if (score >= 70 && (phoneDelta >= 0 || handoffDelta > 0 || current.handoff >= 2)) return "good";
  if (score >= 45 && (current.conversations > 0 || current.withPhone > 0)) return "ok";
  if (convDelta < 0 && phoneDelta < 0 && current.handoff === 0) return "weak";
  if (score < 45) return "weak";
  return "ok";
}

async function listConversations(db: Firestore): Promise<AiConversationRecord[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, AI_CONVERSATIONS_COLLECTION),
        orderBy("lastMessageAt", "desc"),
        limit(200),
      ),
    );
    return snap.docs.map((item) => item.data() as AiConversationRecord);
  } catch {
    const snap = await getDocs(collection(db, AI_CONVERSATIONS_COLLECTION));
    return snap.docs
      .map((item) => item.data() as AiConversationRecord)
      .sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""))
      .slice(0, 200);
  }
}

async function listLeads(db: Firestore): Promise<AiLeadRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, AI_LEADS_COLLECTION), orderBy("createdAt", "desc"), limit(150)),
    );
    return snap.docs.map((item) => item.data() as AiLeadRecord);
  } catch {
    const snap = await getDocs(collection(db, AI_LEADS_COLLECTION));
    return snap.docs
      .map((item) => item.data() as AiLeadRecord)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 150);
  }
}

async function listUsageLogs(db: Firestore): Promise<UsageLogRow[]> {
  try {
    const snap = await getDocs(
      query(collection(db, AI_USAGE_LOGS_COLLECTION), orderBy("createdAt", "desc"), limit(400)),
    );
    return snap.docs.map((item) => item.data() as UsageLogRow);
  } catch {
    try {
      const snap = await getDocs(collection(db, AI_USAGE_LOGS_COLLECTION));
      return snap.docs
        .map((item) => item.data() as UsageLogRow)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 400);
    } catch {
      return [];
    }
  }
}

export async function buildChatbotWeeklyReport(db: Firestore): Promise<ChatbotWeeklyReport> {
  const now = new Date();
  const currentEnd = endOfDay(now);
  const currentStart = startOfDay(daysAgo(now, 6));
  const previousEnd = endOfDay(daysAgo(now, 7));
  const previousStart = startOfDay(daysAgo(now, 13));

  const [conversations, leads, logs] = await Promise.all([
    listConversations(db),
    listLeads(db),
    listUsageLogs(db),
  ]);

  const current = buildPeriodStats(conversations, leads, logs, currentStart, currentEnd);
  const previous = buildPeriodStats(conversations, leads, logs, previousStart, previousEnd);
  const score = scorePeriod(current);
  const verdict = verdictFrom(current, previous, score);

  const recentContacts = conversations
    .filter((row) => inRange(row.lastMessageAt || row.startedAt, currentStart, currentEnd))
    .filter((row) => visitorPhone(row) || visitorName(row))
    .slice(0, 12)
    .map((row) => ({
      name: visitorName(row) || "—",
      phone: visitorPhone(row) || "—",
      intent: row.lastIntent || "—",
      leadStatus: row.leadStatus || "none",
      at: row.lastMessageAt || row.startedAt,
    }));

  return {
    generatedAt: now.toISOString(),
    currentStart: currentStart.toISOString(),
    currentEnd: currentEnd.toISOString(),
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
    current,
    previous,
    verdict,
    score,
    deltas: {
      conversations: current.conversations - previous.conversations,
      withPhone: current.withPhone - previous.withPhone,
      handoff: current.handoff - previous.handoff,
      newLeads: current.newLeads - previous.newLeads,
      conversionRate: current.conversionRate - previous.conversionRate,
    },
    recentContacts,
  };
}

export function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
