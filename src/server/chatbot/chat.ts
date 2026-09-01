import { z } from "zod";
import type {
  ChatErrorCode,
  ChatRequest,
  ChatResponse,
} from "@/lib/chatbot/types";
import {
  emptyCustomerContext,
  extractContextFromMessage,
  hasVisitorContact,
  type CustomerContext,
} from "@/lib/agent/context";
import {
  appendConversationMessage,
  buildConversationRecord,
  loadConversation,
  makeMessageId,
  saveConversation,
} from "@/server/agent/conversationStore";
import { pairedMessageTimestamps } from "@/lib/agent/messageOrder";
import {
  appendConversationMessageAdmin,
  loadConversationAdmin,
  saveConversationAdmin,
} from "@/server/agent/conversationStoreAdmin";
import {
  createKnowledgeCandidate,
  estimateAnswerConfidence,
  shouldCreateKnowledgeCandidate,
} from "@/server/agent/knowledgeCandidates";
import { detectLeadSignal } from "@/server/agent/leadDetection";
import {
  buildAiLeadRecord,
  createAiLeadClient,
  updateAiLeadClient,
} from "@/lib/agent/aiAdminClient";
import { createAiLeadAdmin, updateAiLeadAdmin } from "@/server/agent/leadsStoreAdmin";
import { maybeRunPendingKnowledgeSync } from "@/server/agent/knowledgeSync";
import { tryGetAdminFirestore } from "@/server/agent/firebaseAdmin";
import { logAiUsage } from "@/server/agent/usageLog";
import { getClientFirestoreFallback } from "@/server/agent/clientFirestore";
import type { AiConversationRecord } from "@/lib/agent/types";
import { getChatbotConfig } from "./config";
import { resolveConversationHistory } from "./conversationHistory";
import { createChatRequestId, logChatTrace } from "./chatTrace";
import { checkRateLimit } from "./rateLimit";
import { generateAgentTurn, GeminiServiceError } from "./gemini";
import { composeGeminiKnowledge, getVerbatimCheckSources } from "./knowledge";
import { prepareGeminiHistory } from "./contextManagement";
import { leadPatchFromContext } from "./leadPatch";
import {
  analyzeAgentTurn,
  buildAgentStateBlock,
  buildCompactAgentSummary,
  mergeGeminiAnalysis,
} from "./agent/analyze";
import { sanitizeContextForGemini } from "./agent/contextIsolation";
import {
  decrementWhatsAppBlock,
  noteAssistantQuestion,
  recordCasualReply,
  recordDisclosedFactIds,
  recordDisclosedLevel,
} from "./agent/antiRepetition";
import {
  factIdsToRecord,
  GENERAL_TOPIC_FACT_FOCUSES,
  selectAllowedFacts,
} from "./agent/factSelection";
import { polishAgentReply } from "./agent/responseQuality";
import {
  buildHistoryContextSnippet,
  retrieveKnowledge,
} from "@/server/agent/retrieve";

/** Client history is ignored — only message/session/language are validated. */
export function createChatRequestSchema(maxMessageLength: number) {
  return z.object({
    message: z.string().trim().min(1).max(maxMessageLength),
    language: z.enum(["ar", "en"]),
    sessionId: z
      .string()
      .trim()
      .min(8)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    history: z.unknown().optional(),
  });
}

export { trimHistory } from "./contextManagement";

function redactConversationSummaryForGemini(summary: string): string {
  return summary
    .replace(/(?:الجوال|Phone|الإيميل|Email):\s*[^\n.]+/gi, "")
    .replace(/(?:\+?\d[\d\s\-()]{7,}\d)/g, "")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function validateChatRequest(
  input: unknown,
  config = getChatbotConfig(),
): { ok: true; data: ChatRequest } | { ok: false; code: ChatErrorCode } {
  const schema = createChatRequestSchema(config.maxMessageLength);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    logChatTrace("VALIDATION_FAIL", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
    return { ok: false, code: "VALIDATION" };
  }

  const clientHistory = Array.isArray((input as { history?: unknown })?.history)
    ? (input as { history: unknown[] }).history.length
    : 0;

  if (clientHistory > 0) {
    logChatTrace("CLIENT_HISTORY_IGNORED", { clientHistoryCount: clientHistory });
  }

  return {
    ok: true,
    data: {
      message: parsed.data.message,
      language: parsed.data.language,
      sessionId: parsed.data.sessionId,
      history: [],
    },
  };
}

async function loadExistingConversation(sessionId: string): Promise<AiConversationRecord | null> {
  const adminDb = await tryGetAdminFirestore();
  if (adminDb) return loadConversationAdmin(adminDb, sessionId);
  return loadConversation(getClientFirestoreFallback(), sessionId);
}

async function persistConversationTurn(input: {
  sessionId: string;
  language: "ar" | "en";
  userMessage: string;
  assistantReply: string;
  customerContext: CustomerContext;
  summary: string;
  intent: string;
  retrievedIds: string[];
  confidence: "high" | "medium" | "low";
  leadStatus: "none" | "potential" | "handoff";
  leadId?: string;
}) {
  try {
    const existing = await loadExistingConversation(input.sessionId);
    const record =
      existing ??
      buildConversationRecord({
        sessionId: input.sessionId,
        language: input.language,
        customerContext: input.customerContext,
      });

    record.lastMessageAt = new Date().toISOString();
    record.summary = input.summary;
    record.customerContext = input.customerContext as unknown as Record<string, unknown>;
    const visitorName = input.customerContext.name?.trim() || record.visitorName;
    const visitorPhone = input.customerContext.phone?.trim() || record.visitorPhone;
    const visitorEmail = input.customerContext.email?.trim() || record.visitorEmail;
    if (visitorName) record.visitorName = visitorName;
    else delete record.visitorName;
    if (visitorPhone) record.visitorPhone = visitorPhone;
    else delete record.visitorPhone;
    if (visitorEmail) record.visitorEmail = visitorEmail;
    else delete record.visitorEmail;
    record.lastIntent = input.intent;
    record.leadStatus = input.leadStatus;
    if (input.leadId) record.leadId = input.leadId;

    const { userAt, assistantAt } = pairedMessageTimestamps();
    const userMsg = {
      id: makeMessageId("user"),
      role: "user" as const,
      content: input.userMessage,
      timestamp: userAt,
      intent: input.intent,
      entities: input.customerContext.interests,
      confidence: input.confidence,
    };
    const assistantMsg = {
      id: makeMessageId("assistant"),
      role: "assistant" as const,
      content: input.assistantReply,
      timestamp: assistantAt,
      retrievedKnowledgeIds: input.retrievedIds,
      confidence: input.confidence,
    };

    const adminDb = await tryGetAdminFirestore();
    if (adminDb) {
      await saveConversationAdmin(adminDb, record);
      await appendConversationMessageAdmin(adminDb, input.sessionId, userMsg);
      await appendConversationMessageAdmin(adminDb, input.sessionId, assistantMsg);
      return;
    }

    const clientRecord = { ...record };
    delete clientRecord.visitorName;
    delete clientRecord.visitorPhone;
    delete clientRecord.visitorEmail;
    const db = getClientFirestoreFallback();
    await saveConversation(db, clientRecord);
    await appendConversationMessage(db, input.sessionId, userMsg);
    await appendConversationMessage(db, input.sessionId, assistantMsg);
  } catch {
    // Conversation persistence must not break chat replies.
  }
}

export async function processChatMessage(input: unknown): Promise<ChatResponse> {
  const config = getChatbotConfig();
  const requestId = createChatRequestId();
  const validated = validateChatRequest(input, config);
  const startedAt = Date.now();

  if (!validated.ok) {
    logChatTrace("REQUEST_FAILED", { stage: "validation", code: validated.code }, requestId);
    logAiUsage({ event: "chat_error", errorCode: validated.code });
    return { ok: false, code: validated.code };
  }

  logChatTrace(
    "REQUEST_START",
    {
      sessionId: validated.data.sessionId,
      language: validated.data.language,
      messageLength: validated.data.message.length,
    },
    requestId,
  );

  const rate = checkRateLimit(validated.data.sessionId, config);
  if (!rate.allowed) {
    logChatTrace(
      "REQUEST_FAILED",
      {
        stage: "rate_limit",
        code: "RATE_LIMIT",
        reason: rate.reason,
        sessionId: validated.data.sessionId,
      },
      requestId,
    );
    logAiUsage({
      event: "chat_error",
      sessionId: validated.data.sessionId,
      language: validated.data.language,
      errorCode: "RATE_LIMIT",
    });
    return { ok: false, code: "RATE_LIMIT" };
  }
  logChatTrace("RATE_LIMIT_PASS", { sessionId: validated.data.sessionId }, requestId);

  if (!config.geminiApiKey) {
    logChatTrace(
      "REQUEST_FAILED",
      { stage: "config", code: "CONFIG", sessionId: validated.data.sessionId },
      requestId,
    );
    logAiUsage({
      event: "chat_error",
      sessionId: validated.data.sessionId,
      language: validated.data.language,
      errorCode: "CONFIG",
    });
    return { ok: false, code: "CONFIG" };
  }

  try {
    void maybeRunPendingKnowledgeSync();

    const { history: conversationHistory, source: historySource } =
      await resolveConversationHistory(validated.data.sessionId, validated.data.history);

    logChatTrace(
      "HISTORY_RESOLVED",
      {
        sessionId: validated.data.sessionId,
        source: historySource,
        conversationHistoryCount: conversationHistory.length,
      },
      requestId,
    );

    const existing = await loadExistingConversation(validated.data.sessionId);
    let customerContext = emptyCustomerContext();
    if (existing?.customerContext && typeof existing.customerContext === "object") {
      const stored = existing.customerContext as unknown as CustomerContext;
      customerContext = {
        ...emptyCustomerContext(),
        ...stored,
        interests: Array.isArray(stored.interests) ? stored.interests : [],
      };
    }
    let summary = existing?.summary ?? "";
    const priorLeadStatus = existing?.leadStatus ?? "none";

    const extracted = extractContextFromMessage(
      validated.data.message,
      validated.data.language,
      customerContext,
    );
    customerContext = extracted.context;
    const priorStage = customerContext.conversationStage;
    const priorScore = customerContext.leadScore ?? 0;
    const analyzed = analyzeAgentTurn(
      validated.data.message,
      validated.data.language,
      customerContext,
    );
    customerContext = analyzed.context;
    customerContext.detectedLanguage = validated.data.language;
    customerContext.messageCount = (customerContext.messageCount ?? 0) + 1;
    let agentAnalysis = analyzed.analysis;

    summary = buildCompactAgentSummary(customerContext, agentAnalysis);

    const topicKey = agentAnalysis.disclosureTopic ?? "general";
    const serviceId =
      customerContext.lastServiceMentioned ??
      (topicKey !== "general" ? topicKey : undefined) ??
      "yacht-management-360";
    const disclosedFactIds = customerContext.disclosedFactIdsByTopic?.[topicKey] ?? [];
    const factSelection =
      topicKey !== "general" || GENERAL_TOPIC_FACT_FOCUSES.has(agentAnalysis.questionFocus)
        ? selectAllowedFacts({
            serviceId: serviceId === "general" ? "yacht-management-360" : serviceId,
            disclosureLevel: agentAnalysis.disclosureLevel,
            questionFocus: agentAnalysis.questionFocus,
            intent: agentAnalysis.intent,
            disclosedFactIds,
            language: validated.data.language,
            message: validated.data.message,
            secondaryServiceIds:
              agentAnalysis.questionFocus === "comparison" ? ["marina-management"] : undefined,
          })
        : undefined;

    const geminiHistory = prepareGeminiHistory(conversationHistory, config);
    const historyText = buildHistoryContextSnippet(geminiHistory);

    logChatTrace("GEMINI_START", { sessionId: validated.data.sessionId }, requestId);

    let retrieval: Awaited<ReturnType<typeof retrieveKnowledge>>;
    try {
      retrieval = await retrieveKnowledge(validated.data.message, validated.data.language, {
        context: customerContext,
        historyText,
        retrievalBudget: factSelection
          ? {
              questionFocus: agentAnalysis.questionFocus,
              disclosureLevel: agentAnalysis.disclosureLevel,
              serviceId: factSelection.serviceId ?? serviceId,
              agentIntent: agentAnalysis.intent,
            }
          : undefined,
      });
    } catch {
      retrieval = {
        documents: [],
        formatted: "",
        fromFallback: true,
        analysis: {
          original: validated.data.message,
          normalized: validated.data.message,
          tokens: [],
          intent: "unknown",
          preferredTypes: [],
          entities: [],
        },
        diagnostic: {
          query: validated.data.message,
          normalizedQuery: validated.data.message,
          intent: "unknown",
          entities: [],
          selected: [],
          documentCount: 0,
          fromFallback: true,
          knowledgeSource: "static-fallback",
          retrievalPass: "kb_primary",
          websiteSearchUsed: false,
          sufficiencyReason: "retrieve_error",
        },
      };
    }
    const resolvedIntent = agentAnalysis.intent || retrieval.analysis.intent;
    const topScore = retrieval.diagnostic.selected[0]?.score ?? 0;
    const confidence = estimateAnswerConfidence(topScore, retrieval.documents.length);
    const composeOptions = {
      intent: resolvedIntent,
      disclosureTopic: agentAnalysis.disclosureTopic,
      lastServiceMentioned: customerContext.lastServiceMentioned,
      needsContact:
        agentAnalysis.nextBestAction === "CTA_WHATSAPP" ||
        agentAnalysis.nextBestAction === "HANDOFF" ||
        agentAnalysis.intent === "CONTACT" ||
        agentAnalysis.intent === "WHATSAPP",
      needsPricing:
        agentAnalysis.intent === "PRICING" ||
        agentAnalysis.intent === "YACHT_MANAGEMENT_PRICING" ||
        agentAnalysis.intent === "OBJECTION" ||
        agentAnalysis.questionFocus === "pricing",
      factSelection,
    };
    const composedKnowledge = composeGeminiKnowledge(
      validated.data.language,
      retrieval.formatted,
      composeOptions,
    );
    const verbatimSources = getVerbatimCheckSources(validated.data.language, composeOptions);

    const lead = detectLeadSignal(
      validated.data.message,
      customerContext,
      retrieval.analysis.intent,
      priorLeadStatus,
    );
    if (lead.phone && !customerContext.phone) {
      customerContext = { ...customerContext, phone: lead.phone };
    }
    if (lead.email && !customerContext.email) {
      customerContext = { ...customerContext, email: lead.email };
    }
    if (lead.name && !customerContext.name) {
      customerContext = { ...customerContext, name: lead.name };
    }

    let reply: string;
    try {
      const turn = await generateAgentTurn(
        config,
        validated.data.language,
        validated.data.message,
        geminiHistory,
        composedKnowledge,
        {
          agentStateBlock: buildAgentStateBlock(
            agentAnalysis,
            validated.data.language,
            customerContext,
            factSelection,
          ),
          customerContext: sanitizeContextForGemini(customerContext),
          conversationSummary: redactConversationSummaryForGemini(summary),
          offerHandoff: lead.shouldOfferHandoff || agentAnalysis.nextBestAction === "HANDOFF",
          needsContactCapture: !hasVisitorContact(customerContext),
          contactAlreadyAsked: hasVisitorContact(customerContext),
          verbatimSources,
        },
      );
      agentAnalysis = mergeGeminiAnalysis(agentAnalysis, turn.geminiParsed, customerContext);
      customerContext = {
        ...customerContext,
        conversationStage: agentAnalysis.conversationStage,
        leadScore: agentAnalysis.commercialScore,
        lastTopic: agentAnalysis.intent,
        lastNextBestAction: agentAnalysis.nextBestAction,
      };
      const polished = polishAgentReply({
        reply: turn.reply.trim(),
        language: validated.data.language,
        analysis: agentAnalysis,
        context: customerContext,
        userMessage: validated.data.message,
      });
      agentAnalysis = { ...agentAnalysis, ctaType: polished.ctaType };
      reply = polished.reply;
      customerContext = recordDisclosedLevel(
        customerContext,
        agentAnalysis.disclosureTopic ?? "general",
        agentAnalysis.disclosureLevel,
        validated.data.language,
      );
      if (factSelection && topicKey !== "general") {
        customerContext = recordDisclosedFactIds(
          customerContext,
          topicKey,
          factIdsToRecord(factSelection),
        );
      }
      customerContext = noteAssistantQuestion(customerContext, reply);
      if (agentAnalysis.intent === "GREETING" || agentAnalysis.questionFocus === "casual_greeting") {
        customerContext = recordCasualReply(customerContext, reply);
      }
      customerContext = decrementWhatsAppBlock(customerContext);
      customerContext = { ...customerContext, lastCtaType: polished.ctaType };
      if (!reply.trim()) {
        logChatTrace(
          "REQUEST_FAILED",
          {
            stage: "gemini",
            code: "GEMINI",
            reason: "empty_reply_after_polish",
            sessionId: validated.data.sessionId,
            violations: polished.violations,
          },
          requestId,
        );
        logAiUsage({
          event: "chat_error",
          sessionId: validated.data.sessionId,
          language: validated.data.language,
          errorCode: "GEMINI",
        });
        return { ok: false, code: "GEMINI" };
      }
      logChatTrace(
        "GEMINI_OK",
        {
          sessionId: validated.data.sessionId,
          intent: resolvedIntent,
          confidence,
          replyLength: reply.length,
          knowledgeSource: retrieval.diagnostic.knowledgeSource,
          documentCount: retrieval.documents.length,
          polished: polished.repaired,
          questionFocus: agentAnalysis.questionFocus,
          disclosureLevel: agentAnalysis.disclosureLevel,
          disclosureTopic: agentAnalysis.disclosureTopic,
          allowedFactIds: factSelection?.allowedFactIds,
          hiddenFactIds: factSelection?.hiddenFactIds,
          factSelectionReason: factSelection?.reason,
        },
        requestId,
      );
    } catch (error) {
      const kind = error instanceof GeminiServiceError ? error.kind : "unknown";
      const code: ChatErrorCode =
        kind === "timeout" ? "TIMEOUT" : kind === "context" ? "CONTEXT" : "GEMINI";
      logChatTrace(
        "REQUEST_FAILED",
        {
          stage: "gemini",
          code,
          sessionId: validated.data.sessionId,
          kind,
          hasApiKey: Boolean(config.geminiApiKey),
        },
        requestId,
      );
      logAiUsage({
        event: "chat_error",
        sessionId: validated.data.sessionId,
        language: validated.data.language,
        errorCode: code,
      });
      return { ok: false, code };
    }

    let leadId = existing?.leadId;
    const leadPatch = leadPatchFromContext(customerContext, resolvedIntent);
    const shouldSyncLead =
      Boolean(leadId) || hasVisitorContact(customerContext) || lead.shouldCreateLead;

    if (shouldSyncLead) {
      try {
        const adminDb = await tryGetAdminFirestore();
        if (leadId) {
          if (adminDb) await updateAiLeadAdmin(adminDb, leadId, leadPatch);
          else await updateAiLeadClient(getClientFirestoreFallback(), leadId, leadPatch);
        } else if (lead.shouldCreateLead || hasVisitorContact(customerContext)) {
          const record = buildAiLeadRecord({
            conversationId: validated.data.sessionId,
            context: customerContext,
            phone: lead.phone ?? customerContext.phone,
            email: lead.email ?? customerContext.email,
            name: lead.name ?? customerContext.name,
          });
          if (adminDb) await createAiLeadAdmin(adminDb, record);
          else await createAiLeadClient(getClientFirestoreFallback(), record);
          leadId = record.id;
          logAiUsage({
            event: "lead_created",
            sessionId: validated.data.sessionId,
            language: validated.data.language,
            intent: resolvedIntent,
          });
        }
      } catch {
        // Lead write is best-effort — must not block chat replies.
      }
    }

    logChatTrace("FIRESTORE_PERSIST_START", { sessionId: validated.data.sessionId }, requestId);

    await persistConversationTurn({
      sessionId: validated.data.sessionId,
      language: validated.data.language,
      userMessage: validated.data.message,
      assistantReply: reply,
      customerContext,
      summary,
      intent: resolvedIntent,
      retrievedIds: retrieval.documents.map((doc) => doc.id),
      confidence,
      leadStatus: lead.leadStatus,
      leadId,
    });

    logChatTrace("FIRESTORE_PERSIST_SUCCESS", { sessionId: validated.data.sessionId }, requestId);

    let candidateCreated = false;
    if (
      shouldCreateKnowledgeCandidate({
        intent: resolvedIntent,
        retrievedCount: retrieval.documents.length,
        topScore,
        message: validated.data.message,
      })
    ) {
      try {
        const adminDb = await tryGetAdminFirestore();
        if (adminDb) {
          const id = `kc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await adminDb
            .collection("knowledgeCandidates")
            .doc(id)
            .set({
              id,
              question: validated.data.message.trim().slice(0, 500),
              language: validated.data.language,
              reason: "Low-confidence or missing authoritative website knowledge",
              sourceConversationId: validated.data.sessionId,
              status: "pending",
              createdAt: new Date().toISOString(),
            });
        } else {
          await createKnowledgeCandidate(getClientFirestoreFallback(), {
            question: validated.data.message,
            language: validated.data.language,
            reason: "Low-confidence or missing authoritative website knowledge",
            sourceConversationId: validated.data.sessionId,
          });
        }
        candidateCreated = true;
      } catch {
        // Candidate creation is best-effort.
      }
    }

    if (candidateCreated) {
      logAiUsage({
        event: "candidate_created",
        sessionId: validated.data.sessionId,
        language: validated.data.language,
        intent: resolvedIntent,
        confidence,
      });
    }

    const usageBase = {
      sessionId: validated.data.sessionId,
      language: validated.data.language,
      intent: resolvedIntent,
      stage: agentAnalysis.conversationStage,
      nba: agentAnalysis.nextBestAction,
      ctaType: agentAnalysis.ctaType,
      score: agentAnalysis.commercialScore,
      urgency: agentAnalysis.urgency,
      disclosureLevel: agentAnalysis.disclosureLevel,
      disclosureTopic: agentAnalysis.disclosureTopic,
      objectionTypes: agentAnalysis.objections.join(",") || undefined,
      missingField: agentAnalysis.missingFieldToAsk,
    };
    logAiUsage({ event: "chat_message", ...usageBase });
    logAiUsage({ event: "intent_detected", ...usageBase });
    if (priorStage && priorStage !== agentAnalysis.conversationStage) {
      logAiUsage({ event: "stage_changed", ...usageBase });
    }
    if (priorScore !== agentAnalysis.commercialScore) {
      logAiUsage({ event: "lead_score_changed", ...usageBase });
    }
    if (agentAnalysis.objections.length) {
      logAiUsage({ event: "objection_detected", ...usageBase });
    }
    if (agentAnalysis.nextBestAction === "ASK_MISSING_INFO") {
      logAiUsage({ event: "missing_info_asked", ...usageBase });
    }
    if (
      agentAnalysis.nextBestAction === "CTA_WHATSAPP" ||
      agentAnalysis.nextBestAction === "CTA_CONSULTATION" ||
      agentAnalysis.ctaType === "WHATSAPP" ||
      agentAnalysis.ctaType === "CONSULTATION" ||
      agentAnalysis.ctaType === "HANDOFF"
    ) {
      logAiUsage({ event: "cta_shown", ...usageBase });
    }
    if (agentAnalysis.nextBestAction === "HANDOFF" || agentAnalysis.handoff) {
      logAiUsage({ event: "handoff_triggered", ...usageBase });
    }
    if (agentAnalysis.buyingSignals.includes("start") || agentAnalysis.buyingSignals.includes("offer")) {
      logAiUsage({ event: "conversion_signal", ...usageBase });
    }

    logAiUsage({
      event: "chat_ok",
      ...usageBase,
      fromFallback: retrieval.fromFallback,
      knowledgeSource: retrieval.diagnostic.knowledgeSource,
      documentCount: retrieval.documents.length,
      confidence,
      latencyMs: Date.now() - startedAt,
    });

    logChatTrace(
      "REQUEST_SUCCESS",
      { sessionId: validated.data.sessionId, latencyMs: Date.now() - startedAt },
      requestId,
    );

    return { ok: true, reply };
  } catch (error) {
    const errorCode: ChatErrorCode = "INTERNAL";
    logChatTrace(
      "REQUEST_FAILED",
      {
        stage: "gemini",
        code: errorCode,
        sessionId: validated.data.sessionId,
        conversationHistoryCount: validated.data.history.length,
        errorType: error instanceof Error ? error.name : "unknown",
      },
      requestId,
    );
    logAiUsage({
      event: "chat_error",
      sessionId: validated.data.sessionId,
      language: validated.data.language,
      errorCode,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false, code: errorCode };
  }
}
