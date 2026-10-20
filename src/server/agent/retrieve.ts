import type { AgentLanguage, KnowledgeDocument, KnowledgeDocumentType } from "@/lib/agent/types";
import {
  analyzeQuery,
  ENTITY_SEARCH_TERMS,
  isConceptualYachtOpsNeed,
  needsMultiDocumentReasoning,
  normalizeQueryText,
  preferredTypesForIntent,
  queryMentionsEntity,
  type QueryAnalysis,
} from "@/lib/agent/query";
import type { CustomerContext } from "@/lib/agent/context";
import { getKnowledgeForLanguage } from "@/server/chatbot/knowledge";
import type { QuestionFocus } from "@/server/chatbot/agent/factSelection";
import { getClientFirestoreFallback } from "@/server/agent/clientFirestore";
import { tryGetAdminFirestore } from "./firebaseAdmin";
import { estimateTokens, truncateToTokenBudget } from "./normalize";
import { loadAllKnowledgeDocuments } from "./knowledgeStore";
import { loadAllKnowledgeDocumentsAdmin } from "./knowledgeStoreAdmin";
import { getStaticKnowledgeDocuments } from "./staticKnowledge";
import { isTestOnlyKnowledgeDocument } from "./knowledgeProtect";
import {
  applyWebsitePassScoring,
  assembleMultiDocumentContext,
  evaluateRetrievalSufficiency,
  filterPublicLanguageDocs,
  loadLiveWebsiteKnowledgeDocuments,
  mergeRankedDocuments,
  resetLiveWebsiteCacheForTests,
  type RetrievalPass,
} from "./websiteSearch";

const MAX_DOCUMENTS = 10;
const MAX_RETRIEVAL_TOKENS = 4800;

export interface RetrievalBudgetOptions {
  questionFocus: QuestionFocus;
  disclosureLevel: number;
  serviceId?: string;
  agentIntent?: string;
}

function applyRetrievalBudget(
  docs: KnowledgeDocument[],
  budget?: RetrievalBudgetOptions,
): KnowledgeDocument[] {
  if (!budget || !docs.length) return docs;
  const { questionFocus, disclosureLevel, serviceId, agentIntent } = budget;
  const hay = (d: KnowledgeDocument) => `${d.id} ${d.title} ${d.content}`.toLowerCase();

  if (questionFocus === "scope_overview" && disclosureLevel <= 1 && serviceId) {
    const serviceDocs = docs.filter(
      (d) =>
        d.type === "service" &&
        (d.id.includes(serviceId) || hay(d).includes(serviceId.replace(/-/g, " "))),
    );
    if (serviceDocs.length) return serviceDocs.slice(0, 1);
    return docs.filter((d) => d.type === "service").slice(0, 1);
  }

  if (questionFocus === "progressive_expand" && serviceId) {
    const serviceDocs = docs.filter(
      (d) => d.type === "service" && (d.id.includes(serviceId) || hay(d).includes(serviceId)),
    );
    if (serviceDocs.length) return serviceDocs.slice(0, 1);
    return [];
  }

  if (questionFocus === "owner_value" && serviceId) {
    return docs.filter((d) => d.type === "service" && hay(d).includes(serviceId)).slice(0, 1);
  }

  if (questionFocus === "general_service") {
    return docs.filter((d) => d.type === "service").slice(0, 4);
  }

  if (questionFocus === "pricing" || agentIntent?.includes("PRICING")) {
    return docs
      .filter(
        (d) =>
          d.type === "service" ||
          d.type === "faq" ||
          /pric|cost|limitation|تسع|سعر|تكلف/.test(hay(d)),
      )
      .slice(0, 4);
  }

  if (questionFocus === "comparison") {
    return docs.filter((d) => d.type === "service").slice(0, 3);
  }

  if (questionFocus === "operational") {
    if (serviceId) {
      const serviceDocs = docs.filter(
        (d) => d.type === "service" && (d.id.includes(serviceId) || hay(d).includes(serviceId)),
      );
      if (serviceDocs.length) return serviceDocs.slice(0, 1);
      return [];
    }
    return docs
      .filter(
        (d) =>
          d.type === "service" ||
          /operat|تشغيل|maintenance|صيان|opex|تخطيط/.test(hay(d)),
      )
      .slice(0, 3);
  }

  if (questionFocus === "crew_detail") {
    return docs.filter((d) => /crew|طاقم/.test(hay(d))).slice(0, 3);
  }

  if (agentIntent === "CONTACT" || agentIntent === "WHATSAPP") {
    return docs.filter((d) => ["contact", "company", "about"].includes(d.type)).slice(0, 3);
  }

  return docs;
}

export interface RetrievalDiagnostic {
  query: string;
  normalizedQuery: string;
  intent: string;
  entities: string[];
  selected: Array<{ id: string; type: KnowledgeDocumentType; score: number }>;
  documentCount: number;
  fromFallback: boolean;
  knowledgeSource: "firestore-admin" | "firestore-client" | "static-fallback";
  retrievalPass: RetrievalPass;
  websiteSearchUsed: boolean;
  sufficiencyReason?: string;
}

let cachedFirestoreDocuments: KnowledgeDocument[] | null = null;
let firestoreCacheLoadedAt = 0;
let lastKnowledgeSource: RetrievalDiagnostic["knowledgeSource"] = "static-fallback";
const CACHE_TTL_MS = 5 * 60 * 1000;

function contentHaystack(doc: KnowledgeDocument): string {
  return `${doc.title}\n${doc.content}\n${doc.keywords.join(" ")}`.toLowerCase();
}

/** Lightweight Arabic/English morphology: match stem prefixes for tokens ≥4 chars. */
function textMatchesToken(text: string, token: string): boolean {
  if (!token) return false;
  if (text.includes(token)) return true;
  if (token.length >= 4) {
    const stem = token.slice(0, Math.max(4, token.length - 2));
    if (text.includes(stem)) return true;
  }
  return false;
}

const RETRIEVAL_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "can",
  "you",
  "your",
  "our",
  "with",
  "from",
  "this",
  "that",
  "have",
  "has",
  "had",
  "not",
  "about",
  "into",
  "هل",
  "ما",
  "هي",
  "هو",
  "عن",
  "في",
  "من",
  "على",
  "الى",
  "إلى",
  "هذا",
  "هذه",
  "ذلك",
  "اللي",
  "اي",
  "إيه",
  "ايه",
]);

function isRetrievalToken(token: string): boolean {
  if (/^\d+$/.test(token)) return true;
  if (token.length < 3) return false;
  return !RETRIEVAL_STOPWORDS.has(token);
}

function entityMatchScore(analysis: QueryAnalysis, doc: KnowledgeDocument): number {
  let score = 0;
  const haystack = contentHaystack(doc);
  for (const entity of analysis.entities) {
    const terms = ENTITY_SEARCH_TERMS[entity] ?? [entity];
    if (terms.some((term) => analysis.normalized.includes(normalizeQueryText(term)))) {
      if (
        terms.some(
          (term) => haystack.includes(normalizeQueryText(term)) || haystack.includes(entity),
        )
      ) {
        score += 28;
      }
    }
  }
  for (const [entityKey] of Object.entries(ENTITY_SEARCH_TERMS)) {
    if (queryMentionsEntity(analysis.normalized, entityKey) && haystack.includes(entityKey)) {
      score += 24;
    }
  }
  return score;
}

function scoreDocument(
  doc: KnowledgeDocument,
  analysis: QueryAnalysis,
  context?: CustomerContext,
): number {
  let score = 0;
  let contentHits = 0;
  const haystack = contentHaystack(doc);

  for (const token of analysis.tokens) {
    if (!isRetrievalToken(token)) continue;
    if (textMatchesToken(doc.title.toLowerCase(), token)) {
      score += 16;
      contentHits += 1;
    }
    if (doc.slug && textMatchesToken(doc.slug.toLowerCase(), token)) {
      score += 12;
      contentHits += 1;
    }
    if (
      doc.keywords.some(
        (keyword) =>
          textMatchesToken(keyword, token) || textMatchesToken(token, keyword),
      )
    ) {
      score += 10;
      contentHits += 1;
    }
    if (textMatchesToken(haystack, token)) {
      score += 5;
      contentHits += 1;
    }
  }

  const entityScore = entityMatchScore(analysis, doc);
  score += entityScore;

  if (analysis.intent === "social_media" && (doc.type === "company" || doc.type === "contact")) {
    score += 20;
    if (/instagram|linkedin|facebook|youtube|tiktok|twitter|social|انست|واتس/i.test(haystack)) {
      score += 15;
      contentHits += 1;
    }
  }

  if (analysis.intent === "contact" && (doc.type === "contact" || doc.type === "company"))
    score += 18;
  if (
    analysis.intent === "location" &&
    (doc.type === "location" || doc.type === "company" || doc.type === "about")
  ) {
    score += 16;
  }
  if (
    analysis.intent === "general_company" &&
    ["about", "company", "homepage", "why"].includes(doc.type)
  ) {
    score += 24;
  }
  if (analysis.intent === "services" && doc.type === "service") score += 18;
  if (analysis.intent === "service_details" && doc.type === "service") score += 22;
  if (analysis.intent === "service_comparison" && doc.type === "service") score += 26;
  if (analysis.intent === "yacht_recommendation" && doc.type === "service") score += 22;
  if (analysis.intent === "yacht_recommendation" && doc.type === "faq") score += 10;
  if (analysis.intent === "fleet" && doc.type === "fleet") score += 24;
  if (analysis.intent === "team" && doc.type === "team") score += 24;
  if (analysis.intent === "trust" && doc.type === "trust") score += 24;
  if (analysis.intent === "testimonials" && doc.type === "testimonial") score += 28;
  if (analysis.intent === "gallery" && doc.type === "gallery") score += 26;
  if (analysis.intent === "advertising" && doc.type === "advertisement") score += 28;
  if (analysis.intent === "blog" && doc.type === "blog") score += 22;
  if (analysis.intent === "application" && doc.type === "application") score += 22;
  if (analysis.intent === "pricing" && /not published|غير منشور|custom proposal/i.test(doc.content))
    score += 12;

  // Lexical boosts for Arabic advertising / partnership phrasing on ad docs.
  if (
    doc.type === "advertisement" &&
    /اعلان|إعلان|شراك|advert|partner|branding|حملة|campaign/i.test(analysis.normalized)
  ) {
    score += 18;
    contentHits += 1;
  }
  if (
    doc.type === "testimonial" &&
    /رأي|آراء|تجرب|testimonial|review|client|عميل|عملاء/i.test(analysis.normalized)
  ) {
    score += 16;
    contentHits += 1;
  }
  if (
    doc.type === "fleet" &&
    /أسطول|اسطول|fleet|محفظ|يختات|اليخوت|yacht/i.test(analysis.normalized)
  ) {
    score += 14;
    contentHits += 1;
  }

  if (
    /تشغيل|صيان|طاقم|operations|maintenance|crew|كل حاجه|full management|مش عايز ادير/i.test(
      analysis.normalized,
    )
  ) {
    if (doc.slug === "yacht-management-360") score += 18;
    if (doc.slug === "crew-management") score += 16;
  }

  if (context?.lastServiceMentioned && doc.slug === context.lastServiceMentioned) score += 20;
  if (context?.interests.some((item) => doc.slug?.includes(item.replace(/_/g, "-")))) score += 12;
  if (context?.interests.includes("yacht_management") && doc.slug === "yacht-management-360")
    score += 14;
  if (context?.interests.includes("crew_management") && doc.slug === "crew-management") score += 14;
  if (context?.location && haystack.includes(normalizeQueryText(context.location))) score += 10;
  if (context?.yachtLength && doc.type === "service") score += 6;

  // Type preference only after real lexical/entity evidence — avoids off-topic dumps.
  // Yacht recommendations may be follow-ups ("إيه أنسب حل؟") with weak tokens but rich context.
  const domainHint = analysis.tokens.some((token) =>
    /خدم|service|يخت|yacht|طاقم|crew|تواصل|contact|موقع|location|شرك|company|مارينا|marina|اسعار|price|fleet|محفظ|أسطول|اعلان|إعلان|شراك|رأي|تجرب|معرض|gallery|فريق|team|انسب|مناسب|حل|recommend|suitable/i.test(
      token,
    ),
  );
  if (contentHits === 0 && entityScore === 0) {
    const allowPreferredWithoutHits =
      (domainHint && analysis.preferredTypes.includes(doc.type)) ||
      (analysis.intent === "yacht_recommendation" &&
        analysis.preferredTypes.includes(doc.type));
    if (!allowPreferredWithoutHits) return 0;
  }
  if (analysis.preferredTypes.includes(doc.type)) score += 14;

  return score;
}

async function loadFirestoreDocuments(): Promise<KnowledgeDocument[]> {
  const now = Date.now();
  if (cachedFirestoreDocuments && now - firestoreCacheLoadedAt < CACHE_TTL_MS) {
    return cachedFirestoreDocuments;
  }

  const adminDb = await tryGetAdminFirestore();
  if (adminDb) {
    try {
      const docs = await loadAllKnowledgeDocumentsAdmin(adminDb);
      cachedFirestoreDocuments = docs;
      firestoreCacheLoadedAt = now;
      lastKnowledgeSource = "firestore-admin";
      return docs;
    } catch {
      // Fall through to client SDK.
    }
  }

  try {
    const docs = await loadAllKnowledgeDocuments(getClientFirestoreFallback());
    cachedFirestoreDocuments = docs;
    firestoreCacheLoadedAt = now;
    lastKnowledgeSource = "firestore-client";
    return docs;
  } catch {
    return [];
  }
}

async function loadAllDocuments(): Promise<{
  documents: KnowledgeDocument[];
  fromFallback: boolean;
}> {
  const firestoreDocs = await loadFirestoreDocuments();
  const filterProduction = (docs: KnowledgeDocument[]) =>
    docs.filter((doc) => !isTestOnlyKnowledgeDocument(doc));
  if (firestoreDocs.length > 0) {
    return { documents: filterProduction(firestoreDocs), fromFallback: false };
  }
  lastKnowledgeSource = "static-fallback";
  return { documents: filterProduction(getStaticKnowledgeDocuments()), fromFallback: true };
}

/**
 * Topic intents that must not be answered from adjacent weak/unrelated docs.
 * Empty selection → Gemini receives the empty-knowledge grounding note.
 */
function filterWeakTopicEvidence(
  ranked: Array<{ doc: KnowledgeDocument; score: number }>,
  analysis: QueryAnalysis,
): Array<{ doc: KnowledgeDocument; score: number }> {
  const strictIntents: Record<string, KnowledgeDocumentType[]> = {
    trust: ["trust"],
    team: ["team"],
    fleet: ["fleet"],
    advertising: ["advertisement"],
    testimonials: ["testimonial"],
    gallery: ["gallery"],
  };
  const allowed = strictIntents[analysis.intent];
  if (!allowed) return ranked;

  const strong = ranked.filter(
    (item) => allowed.includes(item.doc.type) && item.score >= 14,
  );
  // Do not pass about/why/homepage as "trust" or "team" evidence.
  return strong;
}

function diversifySelection(
  ranked: Array<{ doc: KnowledgeDocument; score: number }>,
  analysis: QueryAnalysis,
  maxDocs: number,
): Array<{ doc: KnowledgeDocument; score: number }> {
  const selected: Array<{ doc: KnowledgeDocument; score: number }> = [];
  const usedTypes = new Set<KnowledgeDocumentType>();
  const usedServiceSlugs = new Set<string>();

  for (const item of ranked) {
    if (selected.length >= maxDocs) break;
    if (
      usedTypes.has(item.doc.type) &&
      selected.length >= 3 &&
      analysis.intent !== "service_comparison" &&
      analysis.intent !== "yacht_recommendation" &&
      analysis.intent !== "fleet"
    ) {
      continue;
    }
    if (
      analysis.intent === "service_comparison" &&
      item.doc.type === "service" &&
      item.doc.slug &&
      usedServiceSlugs.has(item.doc.slug)
    ) {
      continue;
    }
    selected.push(item);
    usedTypes.add(item.doc.type);
    if (item.doc.type === "service" && item.doc.slug) usedServiceSlugs.add(item.doc.slug);
  }

  if (analysis.intent === "social_media" || analysis.intent === "contact") {
    for (const type of ["company", "contact"] as const) {
      if (selected.some((item) => item.doc.type === type)) continue;
      const candidate = ranked.find((item) => item.doc.type === type);
      if (candidate && selected.length < maxDocs) selected.unshift(candidate);
    }
  }

  if (analysis.intent === "general_company") {
    for (const type of ["about", "company", "homepage"] as const) {
      if (selected.some((item) => item.doc.type === type)) continue;
      const candidate = ranked.find((item) => item.doc.type === type);
      if (candidate && selected.length < maxDocs) selected.push(candidate);
    }
  }

  if (analysis.intent === "service_comparison") {
    const services = ranked.filter((item) => item.doc.type === "service");
    for (const item of services) {
      if (selected.length >= maxDocs) break;
      if (selected.some((s) => s.doc.id === item.doc.id)) continue;
      selected.push(item);
    }
  }

  if (
    (analysis.intent === "services" ||
      analysis.intent === "service_details" ||
      analysis.intent === "yacht_recommendation") &&
    !selected.some((item) => item.doc.type === "service")
  ) {
    const serviceDoc = ranked.find((item) => item.doc.type === "service");
    if (serviceDoc && selected.length < maxDocs) selected.push(serviceDoc);
  }

  const seen = new Set<string>();
  return selected.filter((item) => {
    if (seen.has(item.doc.id)) return false;
    seen.add(item.doc.id);
    return true;
  });
}

export function formatRetrievedKnowledge(documents: KnowledgeDocument[]): string {
  if (!documents.length) return "";
  return documents
    .map(
      (doc, index) =>
        `[${index + 1}] (${doc.type}${doc.url ? ` · ${doc.url}` : ""})\nTitle: ${doc.title}\n${doc.content}`,
    )
    .join("\n\n---\n\n");
}

export async function retrieveKnowledge(
  query: string,
  language: AgentLanguage,
  options?: {
    context?: CustomerContext;
    historyText?: string;
    retrievalBudget?: RetrievalBudgetOptions;
  },
): Promise<{
  documents: KnowledgeDocument[];
  formatted: string;
  fromFallback: boolean;
  analysis: QueryAnalysis;
  diagnostic: RetrievalDiagnostic;
}> {
  const analysis = analyzeQuery(query);
  const historyAnalysis = options?.historyText ? analyzeQuery(options.historyText) : null;
  // Keep current-turn intent authoritative; merge prior entities for scoring only.
  if (historyAnalysis?.entities.length) {
    analysis.entities = [...new Set([...analysis.entities, ...historyAnalysis.entities])];
  }
  // Soft-upgrade vague / conceptual turns into yacht recommendation when needs are clear.
  if (
    (analysis.intent === "unknown" || analysis.intent === "general_question") &&
    (options?.context?.interests?.length ||
      options?.context?.yachtLength ||
      isConceptualYachtOpsNeed(analysis.normalized) ||
      /انسب|مناسب|تنصح|توصي|suitable|recommend/i.test(analysis.normalized))
  ) {
    analysis.intent = "yacht_recommendation";
    analysis.preferredTypes = preferredTypesForIntent("yacht_recommendation");
  }
  const { documents: allDocs, fromFallback } = await loadAllDocuments();
  const languageDocs = allDocs.filter(
    (doc) => doc.language === language && doc.published !== false,
  );

  if (!languageDocs.length) {
    return {
      documents: [],
      formatted: getKnowledgeForLanguage(language),
      fromFallback: true,
      analysis,
      diagnostic: {
        query,
        normalizedQuery: analysis.normalized,
        intent: analysis.intent,
        entities: analysis.entities,
        selected: [],
        documentCount: 0,
        fromFallback: true,
        knowledgeSource: "static-fallback",
        retrievalPass: "kb_primary",
        websiteSearchUsed: false,
        sufficiencyReason: "no_language_docs",
      },
    };
  }

  const ranked = languageDocs
    .map((doc) => ({ doc, score: scoreDocument(doc, analysis, options?.context) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  let selectedItems = diversifySelection(
    filterWeakTopicEvidence(ranked, analysis),
    analysis,
    MAX_DOCUMENTS,
  );
  let retrievalPass: RetrievalPass = "kb_primary";
  let websiteSearchUsed = false;
  let sufficiencyReason = "ok";

  // Even on a strong primary hit, multi-entity questions need complementary types.
  if (needsMultiDocumentReasoning(analysis) && analysis.intent !== "fleet") {
    selectedItems = assembleMultiDocumentContext(
      mergeRankedDocuments(selectedItems, ranked, MAX_DOCUMENTS),
      analysis,
      MAX_DOCUMENTS,
    );
  }

  const primaryTop = selectedItems[0]?.score ?? 0;
  const sufficiency = evaluateRetrievalSufficiency({
    topScore: primaryTop,
    selectedCount: selectedItems.length,
    selectedTypes: selectedItems.map((item) => item.doc.type),
    analysis,
  });
  sufficiencyReason = sufficiency.reason;

  if (sufficiency.needsWebsiteSearch) {
    websiteSearchUsed = true;
    retrievalPass = "website_expanded";

    // Pass A: expanded lexical search over stored public KB (+ other language if needed).
    const searchableKb = filterPublicLanguageDocs(allDocs, language, true).filter(
      (doc) => !isTestOnlyKnowledgeDocument(doc),
    );
    const expandedRanked = filterWeakTopicEvidence(
      applyWebsitePassScoring(
        searchableKb,
        analysis,
        language,
        options?.context,
        scoreDocument,
      ),
      analysis,
    );
    let merged = mergeRankedDocuments(selectedItems, expandedRanked, MAX_DOCUMENTS);
    selectedItems =
      analysis.intent === "fleet" ||
      analysis.intent === "testimonials" ||
      analysis.intent === "advertising" ||
      analysis.intent === "team" ||
      analysis.intent === "trust" ||
      analysis.intent === "gallery"
        ? expandedRanked.slice(0, MAX_DOCUMENTS)
        : assembleMultiDocumentContext(merged, analysis, MAX_DOCUMENTS);

    const expandedTop = selectedItems[0]?.score ?? 0;
    const stillWeak =
      expandedTop < 12 ||
      (needsMultiDocStillWeak(analysis, selectedItems) && expandedTop < 22);

    // Pass B: rebuild searchable website content from CMS/locales (public only, in-memory).
    if (stillWeak) {
      retrievalPass = "website_live";
      const liveDocs = await loadLiveWebsiteKnowledgeDocuments();
      const liveSearchable = filterPublicLanguageDocs(liveDocs, language, true).filter(
        (doc) => !isTestOnlyKnowledgeDocument(doc),
      );
      const liveRanked = filterWeakTopicEvidence(
        applyWebsitePassScoring(
          liveSearchable,
          analysis,
          language,
          options?.context,
          scoreDocument,
        ),
        analysis,
      );
      merged = mergeRankedDocuments(selectedItems, liveRanked, MAX_DOCUMENTS);
      selectedItems =
        analysis.intent === "fleet" ||
        analysis.intent === "testimonials" ||
        analysis.intent === "advertising" ||
        analysis.intent === "team" ||
        analysis.intent === "trust" ||
        analysis.intent === "gallery"
          ? liveRanked.slice(0, MAX_DOCUMENTS)
          : assembleMultiDocumentContext(merged, analysis, MAX_DOCUMENTS);
    }
  }

  // Strict topic intents: never fall back to generic company dumps.
  if (
    ["trust", "team", "fleet", "advertising", "testimonials", "gallery"].includes(
      analysis.intent,
    )
  ) {
    selectedItems = filterWeakTopicEvidence(selectedItems, analysis);
  }

  if (!selectedItems.length) {
    const allowDefaults =
      analysis.intent === "contact" ||
      analysis.intent === "social_media" ||
      analysis.intent === "general_company" ||
      analysis.intent === "location" ||
      analysis.intent === "human_handoff";
    if (allowDefaults) {
      selectedItems = languageDocs
        .filter((doc) => ["company", "contact", "service", "about"].includes(doc.type))
        .slice(0, MAX_DOCUMENTS)
        .map((doc) => ({ doc, score: 1 }));
    }
  }

  const selected = applyRetrievalBudget(
    selectedItems.map((item) => item.doc),
    options?.retrievalBudget,
  );
  let tokenBudget = 0;
  const bounded: KnowledgeDocument[] = [];
  for (const doc of selected) {
    const docTokens = estimateTokens(doc.content);
    if (tokenBudget + docTokens > MAX_RETRIEVAL_TOKENS && bounded.length > 0) continue;
    bounded.push(doc);
    tokenBudget += docTokens;
    if (bounded.length >= MAX_DOCUMENTS) break;
  }

  const formatted = truncateToTokenBudget(formatRetrievedKnowledge(bounded), MAX_RETRIEVAL_TOKENS);
  const diagnostic: RetrievalDiagnostic = {
    query,
    normalizedQuery: analysis.normalized,
    intent: analysis.intent,
    entities: analysis.entities,
    selected: selectedItems
      .filter((item) => bounded.some((doc) => doc.id === item.doc.id))
      .map((item) => ({ id: item.doc.id, type: item.doc.type, score: item.score })),
    documentCount: bounded.length,
    fromFallback,
    knowledgeSource: lastKnowledgeSource,
    retrievalPass,
    websiteSearchUsed,
    sufficiencyReason,
  };

  if (process.env.CHATBOT_RETRIEVAL_DEBUG === "1") {
    console.info("[retrieval]", JSON.stringify(diagnostic));
  }

  return { documents: bounded, formatted, fromFallback, analysis, diagnostic };
}

function needsMultiDocStillWeak(
  analysis: QueryAnalysis,
  selected: Array<{ doc: KnowledgeDocument; score: number }>,
): boolean {
  const types = new Set(selected.map((item) => item.doc.type));
  if (analysis.entities.length >= 2 && types.size < 2) return true;
  if (analysis.intent === "yacht_recommendation" && !types.has("service")) return true;
  return false;
}

export function resetKnowledgeCacheForTests() {
  cachedFirestoreDocuments = null;
  firestoreCacheLoadedAt = 0;
  lastKnowledgeSource = "static-fallback";
  resetLiveWebsiteCacheForTests();
}

export function rankDocumentsForQuery(
  documents: KnowledgeDocument[],
  query: string,
  language: AgentLanguage,
  context?: CustomerContext,
): KnowledgeDocument[] {
  const analysis = analyzeQuery(query);
  return documents
    .filter((doc) => doc.language === language)
    .map((doc) => ({ doc, score: scoreDocument(doc, analysis, context) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc);
}

export function buildHistoryContextSnippet(
  history: Array<{ role: string; content: string }>,
  maxItems = 4,
): string {
  return history
    .slice(-maxItems)
    .map((item) => item.content)
    .join(" ");
}
