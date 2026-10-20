import type { ChatLanguage } from "@/lib/chatbot/types";
import type { CustomerContext } from "@/lib/agent/context";
import { mergeCustomerContext } from "@/lib/agent/context";
import type {
  AgentAnalysis,
  AgentEntities,
  ConversationStage,
  GeminiAgentOutput,
  NextBestAction,
  UrgencyLevel,
} from "./types";

import {
  advanceDisclosureLevel,
  buildProgressiveDisclosureBlock,
  detectProgressiveRequest,
  detectScopeQuestion,
  resolveDisclosureTopic,
} from "./progressiveDisclosure";
import {
  adjustNbaForObjections,
  blocksWhatsAppCta,
  buildObjectionGuidance,
  sanitizeReplyForObjections,
} from "./objectionGuidance";
import {
  blockWhatsAppForTurns,
  buildAntiRepetitionBlock,
} from "./antiRepetition";
import {
  appendPublishedWhatsAppUrl,
  replyContainsPublishedWhatsAppUrl,
} from "../contactChannels";
import {
  resolveQuestionFocus,
  detectWhatsAppRequest,
  detectPhoneRequest,
  detectWebsiteAttribution,
  detectChatbotIdentity,
  detectYachtRental,
  detectAmbiguousYachtNeed,
} from "./factSelection";
import type { FactSelectionResult } from "./factSelection";
import { resolveCtaType } from "./ctaIntelligence";
import { detectTopicShift, resolveActiveObjections } from "./contextIsolation";

export { sanitizeReplyForObjections };

const SERVICE_FIELD_PRIORITY: Record<string, string[]> = {
  "yacht-management-360": ["yachtLength", "location", "customerGoal", "yachtType"],
  "crew-management": ["yachtLength", "location", "yachtType"],
  "marina-management": ["location"],
  "visiting-yacht-agency": ["location", "customerGoal"],
};

export function extractYachtLength(message: string): string | undefined {
  const text = message.normalize("NFKC");
  const meter = text.match(/(\d+(?:\.\d+)?)\s*(?:متر(?:ا|ة)?|meters?)/i);
  if (meter) return `${meter[1]}m`;
  const gluedM = text.match(/(\d+(?:\.\d+)?)m\b/i);
  if (gluedM) return `${gluedM[1]}m`;
  const spacedM = text.match(/(\d+(?:\.\d+)?)\s+m\b/i);
  if (spacedM) return `${spacedM[1]}m`;
  const feetAr = text.match(/(\d+(?:\.\d+)?)\s*قدم/);
  if (feetAr) return `${feetAr[1]}ft`;
  const feetEn = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\b/i);
  if (feetEn) return `${feetEn[1]}ft`;
  const gluedFt = text.match(/(\d+(?:\.\d+)?)ft\b/i);
  if (gluedFt) return `${gluedFt[1]}ft`;
  return undefined;
}

export function extractLocation(message: string, language: ChatLanguage): string | undefined {
  const text = message.normalize("NFKC").toLowerCase();
  if (/جدة|jeddah|jedah/.test(text)) return language === "ar" ? "جدة" : "Jeddah";
  if (/البحر الأحمر|red sea/.test(text)) return language === "ar" ? "البحر الأحمر" : "Red Sea";
  if (/نيوم|neom/.test(text)) return "NEOM";
  if (/دبي|dubai/.test(text)) return language === "ar" ? "دبي" : "Dubai";
  if (/الخليج|gulf/.test(text)) return language === "ar" ? "الخليج" : "Gulf";
  return undefined;
}

export function extractServiceId(message: string): string | undefined {
  const text = message.normalize("NFKC").toLowerCase();
  const hasCrew = /طاقم|طواقم|crew/.test(text);
  const hasMarina = /مارينا|marina|رسو|berth/.test(text);
  const hasVisiting = /زائر|visiting|agency|وكال/.test(text);
  const hasYachtWord = /يخت|yacht/.test(text);
  const hasMgmtWord = /إدارة|ادارة|management|360|mgmt|managment/.test(text);
  const hasRental = /(?:^|\s)(?:تأجير|تاجير|ايجار|إيجار|charter|rent(?:al)?)/.test(text);

  if (hasRental && hasYachtWord) return undefined;
  if (/عندي\s*يخت|أملك\s*يخت|own(?:ing)?\s*(?:a\s*)?yacht|i\s+have\s+a\s+yacht/.test(text) && hasMgmtWord) {
    return "yacht-management-360";
  }
  if (/أدير|ادير|manage|managing/.test(text) && hasYachtWord) return "yacht-management-360";
  if (hasVisiting && !hasMgmtWord) return "visiting-yacht-agency";
  if (hasMarina && !hasYachtWord && !hasMgmtWord) return "marina-management";
  if (hasMgmtWord && hasYachtWord) return "yacht-management-360";
  if (hasMgmtWord && /كاملة/.test(text)) return "yacht-management-360";
  if (hasCrew && !hasMgmtWord) return "crew-management";
  if (hasMgmtWord && !hasMarina && !hasCrew) return "yacht-management-360";
  if (hasCrew) return "crew-management";
  if (hasMarina) return "marina-management";
  if (hasVisiting) return "visiting-yacht-agency";
  return undefined;
}

export function extractYachtType(message: string): string | undefined {
  const text = message.normalize("NFKC").toLowerCase();
  if (/شراع|sail/.test(text)) return "sailing";
  if (/موتور|motor|motor yacht/.test(text)) return "motor";
  if (/سوبر|super ?yacht|superyacht/.test(text)) return "superyacht";
  if (/كاتاماران|catamaran/.test(text)) return "catamaran";
  return undefined;
}

export function detectBuyingSignals(message: string): string[] {
  const text = message.normalize("NFKC").toLowerCase();
  const signals: string[] = [];
  if (/أبي أبدأ|ابي ابدأ|عايز أبدأ|عايز ابدأ|أريد أبدأ|i want to start|want to start|هبدأ|i want to proceed|ready to start|how can i start/.test(text)) {
    signals.push("start");
  }
  if (/أبي عرض|ابي عرض|أرسلوا لي عرض|send me an offer|send me details|proposal|quote|عرض سعر|book consultation/.test(text)) {
    signals.push("offer");
  }
  if (/حجز|احجز|أحجز|book(?:ing)?|reserve|reservation|موعد|appointment/i.test(text)) {
    signals.push("booking");
  }
  if (/كمل|أكمل|complete|next step|الخطوة|proceed|follow up|متابعة|أكمل الطلب|complete (?:the )?booking/i.test(text)) {
    signals.push("proceed");
  }
  if (/أتعاقد|كيف أتعاقد|how can i sign|contract|عقد/.test(text)) signals.push("contract");
  if (/متى تقدرون تبدأون|when can you start|متى تبدأون/.test(text)) signals.push("start_timing");
  if (/أحتاج إدارة الآن|ابي إدارة الآن|need management now/.test(text)) signals.push("need_now");
  if (/أبي أكلم|عايز أكلم|كلموني|أبي أتواصل|أحتاج أحد يتواصل|contact me|speak (to|with)|talk to someone/i.test(text)) {
    signals.push("talk_to_human");
  }
  if (/كم السعر|how much|price\?/i.test(text)) signals.push("pricing_interest");
  return signals;
}

export function detectObjections(message: string): string[] {
  const text = message.normalize("NFKC").toLowerCase();
  const found: string[] = [];
  if (/غالي|expensive|why is it expensive|السعر عالي|too expensive|your price is high|price is high/i.test(text)) {
    found.push("price");
  }
  if (/بفكر|خلني أفكر|خليني افكر|i need to think|let me think|need time|أحتاج وقت/i.test(text)) {
    found.push("thinking");
  }
  if (/أقارن|بأقارن|باقارن|باقارنكم|comparing|compare options|شركات ثانية|company th|i'm comparing providers/i.test(text)) {
    found.push("compare");
  }
  if (/لقيت شركة أرخص|found (?:a )?cheaper|cheaper provider/i.test(text)) {
    found.push("compare");
  }
  if (/مو متأكد|مش متأكد|not sure|غير متأكد/.test(text)) found.push("unsure");
  if (/ما أبي أتواصل|مش عايز أتواصل|don't want to (contact|talk)|ليس الآن|مش دلوقتي|ما أبي الحين/.test(text)) {
    found.push("no_contact_now");
  }
  if (/ما أبي واتساب|مش عايز واتس|don't want whatsapp|بدون واتساب|لا ترسل لي واتساب|i don't want whatsapp/i.test(text)) {
    found.push("no_whatsapp");
  }
  return found;
}

export function detectUrgency(message: string, context?: CustomerContext): UrgencyLevel {
  const text = message.normalize("NFKC").toLowerCase();

  if (/^(الآن|now)\s*[?؟.!]*$/i.test(text)) return "LOW";

  if (
    /^(وش|what|which|ايش|ممكن).*(خدمات|services).*(اليوم|today)?/i.test(text) ||
    /^(ممكن أعرف|can i know|tell me about).*(خدمات|services)/i.test(text)
  ) {
    return "LOW";
  }

  if (
    /^(وش|what|which|ايش).*(خدمات|services).*(اليوم|today)/.test(text) ||
    (/(اليوم|today)/.test(text) &&
      /(خدمات|services|عندكم|offer|available)/.test(text) &&
      !/عاجل|urgent|asap|أحتاج|need|الآن|now|immediately|ضروري|إدارة|management|تواصل|contact/i.test(text))
  ) {
    return "LOW";
  }

  const actionable =
    /أحتاج|need|أبي|أريد|want|ابي|عايز|تواصل|contact|إدارة|management|start|ابدأ|urgent|عاجل|ضروري/i.test(text);

  const highPatterns = [
    /عاجل|asap|immediately|urgent/,
    /أحتاج.*(اليوم|الآن|now|today)/,
    /(اليوم|الآن|now|today).*(إدارة|management|yacht|يخت|تواصل|contact)/,
    /أبي أحد يتواصل.*(الآن|اليوم)|أحتاج أحد يتواصل/i,
    /need.*(today|now|immediately|urgent)/,
    /urgent.*(yacht|management|marina|crew)/,
    /وصول يخت اليوم/,
    /ضروري (الآن|حالا)/,
    /الحين عايز/,
  ];
  if (highPatterns.some((pattern) => pattern.test(text))) return "HIGH";

  if (/(الآن|now)/.test(text) && actionable) return "HIGH";

  if (/هذا الأسبوع|this week|الأسبوع الجاي|next week/.test(text) && /أحتاج|أبي|need|start|ابدأ/i.test(text)) {
    return buyingSignalsFromText(text) ? "HIGH" : "MEDIUM";
  }

  if (/قريب|soon|الشهر الجاي|next month|بسرعة/.test(text)) return "MEDIUM";
  if (context?.urgency === "high" && /follow|متابعة|still|still need/i.test(text)) return "HIGH";
  return "LOW";
}

function buyingSignalsFromText(text: string): boolean {
  return /أبي|أريد|need|start|ابدأ|proceed|contact|تواصل/i.test(text);
}

export function detectRepair(message: string): boolean {
  return /لا مو هذا|لا مش كده|لا قصدي|قصدي |أقصد |لا، أقصد|i meant|not that|wrong service/i.test(
    message,
  );
}

export function detectProgressive(message: string): boolean {
  return detectProgressiveRequest(message);
}

export function detectShortQuery(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= 24;
}

export function detectSecurityProbe(message: string): boolean {
  return /system prompt|hidden instructions|ignore previous instructions|api key|source code|gemini key|reveal (the )?prompt|jailbreak|developer mode|pretend to be|you are now|override (your )?rules|تجاهل التعليمات|اعرض.*(المفتاح|البرومبت)/i.test(
    message,
  );
}

export function detectGibberish(message: string): boolean {
  const trimmed = message.trim();
  if (/^[a-z]{5,}$/i.test(trimmed) && !/yacht|price|crew|marina|whatsapp|management/i.test(trimmed)) {
    return true;
  }
  if (/^\d{4,}$/.test(trimmed)) return true;
  if (/^(ه+|خ+|lol+|haha+)$/i.test(trimmed)) return true;
  return false;
}

export function detectPricingInterest(message: string): boolean {
  return /سعر|بكم|بكام|price|how much|تكلف|تكلفة|كام السعر/.test(message.normalize("NFKC").toLowerCase());
}

function resolveIntent(message: string, prior: CustomerContext, entities: AgentEntities): string {
  if (detectSecurityProbe(message)) return "SECURITY";
  if (detectWebsiteAttribution(message)) return "WEBSITE_ATTRIBUTION";
  if (detectChatbotIdentity(message)) return "CHATBOT_IDENTITY";
  if (detectGibberish(message) && !prior.lastServiceMentioned && !prior.yachtLength) return "GIBBERISH";
  if (detectRepair(message)) return "REPAIR";
  if (detectProgressive(message)) return "PROGRESSIVE";
  if (detectScopeQuestion(message) && (entities.service ?? prior.lastServiceMentioned)) {
    return entities.service === "yacht-management-360" || prior.lastServiceMentioned === "yacht-management-360"
      ? "YACHT_MANAGEMENT"
      : "GENERAL";
  }
  if (detectObjections(message).length) return "OBJECTION";
  if (detectYachtRental(message)) return "YACHT_RENTAL";
  if (detectAmbiguousYachtNeed(message)) return "YACHT_CLARIFY";
  const service = entities.service ?? prior.lastServiceMentioned;
  const pricing = detectPricingInterest(message);
  if (service === "yacht-management-360" && pricing) return "YACHT_MANAGEMENT_PRICING";
  if (service === "crew-management") return "CREW_MANAGEMENT";
  if (service === "marina-management") return "MARINA_MANAGEMENT";
  if (service === "visiting-yacht-agency") return "VISITING_YACHT_AGENCY";
  if (service === "yacht-management-360") return "YACHT_MANAGEMENT";
  if (pricing) return "PRICING";
  if (detectWhatsAppRequest(message)) return "WHATSAPP";
  if (detectPhoneRequest(message)) return "CONTACT";
  if (/تواصل|contact|email|ايميل|بريد|contact form|نموذج/.test(message.toLowerCase())) return "CONTACT";
  if (/what services|what do you offer|services do you|what can you help/i.test(message.toLowerCase())) {
    return "SERVICES";
  }
  if (/خدمات|services/.test(message.toLowerCase())) return "SERVICES";
  if (/سلام|مرحبا|hello|hi\b|ازيك|ازي|إزيك|كيف\s*حال|شلون|how are you|what's up|good morning|good evening|صباح|مساء/.test(message.toLowerCase())) {
    return "GREETING";
  }
  if (prior.lastServiceMentioned && detectShortQuery(message)) {
    if (pricing) return prior.lastServiceMentioned.includes("yacht")
      ? "YACHT_MANAGEMENT_PRICING"
      : "PRICING";
    return "GENERAL";
  }
  return "GENERAL";
}

function secondaryIntents(message: string, primary: string): string[] {
  const extra: string[] = [];
  const service = extractServiceId(message);
  if (/طاقم|crew/.test(message.toLowerCase()) && primary !== "CREW_MANAGEMENT") {
    extra.push("CREW_MANAGEMENT");
  }
  if (detectPricingInterest(message) && !primary.includes("PRICING")) extra.push("PRICING");
  if (service === "marina-management" && primary !== "MARINA_MANAGEMENT") extra.push("MARINA_MANAGEMENT");
  return extra;
}

export function missingFieldsForService(
  service: string | undefined,
  context: CustomerContext,
  score = 0,
): string[] {
  if (!service) return [];
  const priority = SERVICE_FIELD_PRIORITY[service] ?? [];
  return priority.filter((field) => {
    if (field === "yachtLength") return !context.yachtLength;
    if (field === "location") return !context.location;
    if (field === "yachtType") {
      if (service === "yacht-management-360") return score >= 45 && !context.yachtType;
      return !context.yachtType;
    }
    if (field === "customerGoal") {
      if (!context.yachtLength || !context.location) return false;
      return !context.customerGoal;
    }
    return false;
  });
}

export function computeCommercialScore(
  message: string,
  context: CustomerContext,
  signals: string[],
): number {
  let score = 8;
  if (context.lastServiceMentioned) score += 12;
  if (context.yachtLength) score += 16;
  if (context.location) score += 12;
  if (context.yachtType) score += 8;
  if (context.yachtMentioned) score += 6;
  if (detectPricingInterest(message)) score += 14;
  if (signals.includes("start") || signals.includes("need_now")) score += 22;
  if (signals.includes("offer") || signals.includes("contract")) score += 20;
  if (signals.includes("booking") || signals.includes("proceed")) score += 18;
  if (signals.includes("talk_to_human")) score += 12;
  if (signals.includes("start_timing")) score += 10;
  if (context.yachtLength && context.location) score += 10;
  if (context.urgency === "high") score += 12;
  if (detectObjections(message).includes("price")) score += 6;
  return Math.max(0, Math.min(100, score));
}

export function resolveConversationStage(
  message: string,
  context: CustomerContext,
  score: number,
  objections: string[],
  signals: string[],
): ConversationStage {
  if (signals.includes("talk_to_human") && (context.name || context.phone)) return "HANDOFF";
  if (objections.length) return "OBJECTION";
  if (score >= 70 || signals.includes("start") || signals.includes("offer") || signals.includes("booking")) {
    return "HIGH_INTENT";
  }
  if (detectPricingInterest(message) || score >= 45) return "CONSIDERATION";
  if (context.yachtLength && context.location && context.lastServiceMentioned) return "QUALIFICATION";
  if (context.lastServiceMentioned) return "SERVICE_IDENTIFICATION";
  return "DISCOVERY";
}

export function resolveNextBestAction(input: {
  message: string;
  context: CustomerContext;
  score: number;
  stage: ConversationStage;
  urgency: UrgencyLevel;
  missing: string[];
  objections: string[];
  signals: string[];
  security: boolean;
  gibberish: boolean;
  repair: boolean;
  progressive: boolean;
}): NextBestAction {
  const refusedWhatsapp = input.objections.includes("no_whatsapp") ||
    input.context.requestedContactMethod === "email";
  if (input.security) return "ANSWER";
  if (input.gibberish && !input.context.lastServiceMentioned) return "CLARIFY";
  if (input.repair && !extractServiceId(input.message)) return "CLARIFY";
  if (input.progressive) return "SHOW_MORE";
  if (detectScopeQuestion(input.message) && input.context.lastServiceMentioned) return "ANSWER";
  if (detectPhoneRequest(input.message)) return "ANSWER";
  if (detectWebsiteAttribution(input.message) || detectChatbotIdentity(input.message)) return "ANSWER";
  if (detectYachtRental(input.message)) return "ANSWER";
  if (detectAmbiguousYachtNeed(input.message)) return "CLARIFY";
  if (detectWhatsAppRequest(input.message) && !refusedWhatsapp) {
    return "CTA_WHATSAPP";
  }
  if (input.signals.includes("talk_to_human")) {
    const handoffNba = refusedWhatsapp ? "CTA_CONSULTATION" : "HANDOFF";
    return adjustNbaForObjections(handoffNba, input.objections, input.context);
  }
  if (input.objections.length) {
    return adjustNbaForObjections("ANSWER", input.objections, input.context);
  }
  if (input.urgency === "HIGH" && input.score >= 55 && !refusedWhatsapp) return "HANDOFF";
  const contactReady = Boolean(input.context.name && input.context.phone);
  if (
    !refusedWhatsapp &&
    contactReady &&
    input.context.lastServiceMentioned &&
    (input.signals.includes("booking") ||
      input.signals.includes("proceed") ||
      input.signals.includes("pricing_interest")) &&
    input.score >= 45
  ) {
    return "CTA_WHATSAPP";
  }
  if (
    (input.signals.includes("start") ||
      input.signals.includes("offer") ||
      input.signals.includes("contract") ||
      input.signals.includes("booking") ||
      input.signals.includes("proceed") ||
      (contactReady && input.score >= 58) ||
      input.score >= 70) &&
    !refusedWhatsapp
  ) {
    if (input.signals.includes("offer") && !input.signals.includes("booking")) {
      return contactReady ? "CTA_WHATSAPP" : "CTA_CONSULTATION";
    }
    return "CTA_WHATSAPP";
  }
  const askingDetails = detectPricingInterest(input.message) || detectProgressive(input.message);
  if (
    input.missing.length > 0 &&
    !askingDetails &&
    !input.signals.length &&
    input.score < 70 &&
    input.context.lastServiceMentioned
  ) {
    return "ASK_MISSING_INFO";
  }
  if (
    input.context.yachtLength &&
    input.context.location &&
    input.context.lastServiceMentioned &&
    input.score >= 40 &&
    input.score < 70
  ) {
    return "QUALIFY";
  }
  return "ANSWER";
}

export function analyzeAgentTurn(
  message: string,
  language: ChatLanguage,
  prior: CustomerContext,
): { analysis: AgentAnalysis; context: CustomerContext } {
  const yachtLength = extractYachtLength(message) ?? prior.yachtLength;
  const location = extractLocation(message, language) ?? prior.location;
  const service = extractServiceId(message) ?? prior.lastServiceMentioned;
  const yachtType = extractYachtType(message) ?? prior.yachtType;
  const buyingSignals = detectBuyingSignals(message);
  const detectedObjections = detectObjections(message);
  const objections = resolveActiveObjections(prior.objections ?? [], message, detectedObjections);
  const topicShift = detectTopicShift(message);
  const scopeQuestion = detectScopeQuestion(message);
  const progressive = detectProgressive(message);
  const repair = detectRepair(message);
  const security = detectSecurityProbe(message);
  const gibberish = detectGibberish(message);
  const goal = topicShift && !detectPricingInterest(message) && !buyingSignals.length
    ? prior.customerGoal
    : buyingSignals.includes("start")
      ? "start_management"
      : detectPricingInterest(message)
        ? "pricing"
        : prior.customerGoal;

  const urgency = detectUrgency(message, prior);
  const merged = mergeCustomerContext(prior, {
    yachtLength,
    location,
    yachtType,
    lastServiceMentioned: service,
    customerGoal: goal,
    yachtMentioned: prior.yachtMentioned || /يخت|yacht|قارب|boat/.test(message.toLowerCase()),
    urgency:
      urgency === "HIGH" ? "high" : urgency === "MEDIUM" ? "medium" : prior.urgency ?? "low",
    requestedContactMethod: detectWhatsAppRequest(message)
      ? "whatsapp"
      : detectPhoneRequest(message)
        ? "phone"
        : prior.requestedContactMethod,
    interests: [
      ...(service === "yacht-management-360" ? ["yacht_management"] : []),
      ...(service === "crew-management" ? ["crew_management"] : []),
      ...(service === "marina-management" ? ["marina_management"] : []),
    ],
  });

  const entities: AgentEntities = {
    yachtLength: merged.yachtLength,
    yachtType: merged.yachtType,
    location: merged.location,
    service: merged.lastServiceMentioned,
    customerGoal: merged.customerGoal,
  };

  const intent = resolveIntent(message, merged, entities);
  const secondary = secondaryIntents(message, intent);
  const topicKey = resolveDisclosureTopic(service, intent);
  const questionFocus = resolveQuestionFocus(message, intent);
  const disclosureByTopic = { ...(merged.disclosureByTopic ?? {}) };
  let disclosureLevel = disclosureByTopic[topicKey] ?? 0;
  if (scopeQuestion && topicKey !== "general") {
    disclosureLevel = advanceDisclosureLevel(disclosureLevel, "scope");
    disclosureByTopic[topicKey] = disclosureLevel;
  } else if (progressive && topicKey !== "general" && disclosureLevel > 0) {
    disclosureLevel = advanceDisclosureLevel(disclosureLevel, "progressive");
    disclosureByTopic[topicKey] = disclosureLevel;
  }
  if (
    (buyingSignals.includes("start") ||
      buyingSignals.includes("offer") ||
      buyingSignals.includes("talk_to_human")) &&
    topicKey !== "general"
  ) {
    disclosureLevel = Math.max(disclosureLevel, 4);
    disclosureByTopic[topicKey] = disclosureLevel;
  }

  const commercialScore = computeCommercialScore(message, merged, buyingSignals);
  const missingInformation = missingFieldsForService(merged.lastServiceMentioned, merged, commercialScore);
  const asked = merged.askedMissingFields ?? [];
  const missingFieldToAsk = missingInformation.find((field) => !asked.includes(field));
  const conversationStage = resolveConversationStage(
    message,
    merged,
    commercialScore,
    objections,
    buyingSignals,
  );
  const nextBestAction = adjustNbaForObjections(
    resolveNextBestAction({
      message,
      context: merged,
      score: commercialScore,
      stage: conversationStage,
      urgency,
      missing: missingInformation,
      objections,
      signals: buyingSignals,
      security,
      gibberish,
      repair,
      progressive,
    }),
    objections,
    merged,
  );

  const nextAsked =
    nextBestAction === "ASK_MISSING_INFO" && missingFieldToAsk
      ? [...asked, missingFieldToAsk]
      : asked;

  const context: CustomerContext = {
    ...merged,
    leadScore: commercialScore,
    conversationStage,
    lastTopic: intent,
    recentIntents: [...(merged.recentIntents ?? []), intent].slice(-6),
    askedMissingFields: nextAsked,
    disclosureLevel,
    disclosureByTopic,
    lastNextBestAction: nextBestAction,
    objections,
    objectionHistory: [
      ...new Set([...(merged.objectionHistory ?? merged.objections ?? []), ...detectedObjections]),
    ].slice(-8),
    buyingSignals: [...new Set([...(merged.buyingSignals ?? []), ...buyingSignals])].slice(-8),
  };

  let resolvedContext = context;
  if (detectedObjections.includes("no_whatsapp")) {
    resolvedContext = blockWhatsAppForTurns(context, 2);
  }

  const handoff = nextBestAction === "HANDOFF" || conversationStage === "HANDOFF";
  const draftAnalysis: AgentAnalysis = {
    intent,
    secondaryIntents: secondary,
    conversationStage,
    commercialScore,
    nextBestAction,
    urgency,
    entities,
    missingInformation,
    missingFieldToAsk,
    leadSignals: buyingSignals,
    objections,
    buyingSignals,
    handoff,
    repair,
    progressive,
    shortQuery: detectShortQuery(message),
    security,
    gibberish,
    disclosureLevel,
    disclosureTopic: topicKey,
    questionFocus,
  };

  return {
    context: resolvedContext,
    analysis: {
      ...draftAnalysis,
      ctaType: resolveCtaType(draftAnalysis, resolvedContext),
    },
  };
}

export function mergeGeminiAnalysis(
  server: AgentAnalysis,
  gemini: GeminiAgentOutput | null,
  context?: CustomerContext,
): AgentAnalysis {
  if (!gemini) return server;
  let nba = server.nextBestAction;
  if (server.security) nba = "ANSWER";
  nba = adjustNbaForObjections(nba, server.objections, context);

  return {
    ...server,
    intent: gemini.intent?.trim() || server.intent,
    secondaryIntents: gemini.secondaryIntents?.length
      ? gemini.secondaryIntents
      : server.secondaryIntents,
    conversationStage: server.conversationStage,
    nextBestAction: nba,
    urgency: server.urgency,
    handoff: server.handoff || Boolean(gemini.handoff),
    commercialScore: server.commercialScore,
    missingInformation: server.missingInformation,
    objections: server.objections,
    buyingSignals: server.buyingSignals,
    disclosureLevel: server.disclosureLevel,
    disclosureTopic: server.disclosureTopic,
    questionFocus: server.questionFocus,
    ctaType: server.ctaType,
    entities: {
      yachtLength: server.entities.yachtLength ?? gemini.entities?.yachtLength ?? undefined,
      yachtType: server.entities.yachtType ?? gemini.entities?.yachtType ?? undefined,
      location: server.entities.location ?? gemini.entities?.location ?? undefined,
      service: server.entities.service ?? gemini.entities?.service ?? undefined,
      customerGoal: server.entities.customerGoal ?? gemini.entities?.customerGoal ?? undefined,
    },
  };
}

export function maybeAttachWhatsApp(reply: string, analysis: AgentAnalysis): string {
  let text = sanitizeReplyForObjections(reply, analysis.objections);
  if (blocksWhatsAppCta(analysis.objections)) return text;
  if (analysis.questionFocus === "contact_phone") return text;
  if (analysis.nextBestAction !== "CTA_WHATSAPP" && analysis.nextBestAction !== "HANDOFF") {
    return text;
  }
  if (replyContainsPublishedWhatsAppUrl(text)) return text;
  return appendPublishedWhatsAppUrl(text);
}

export function buildAgentStateBlock(
  analysis: AgentAnalysis,
  language: ChatLanguage,
  context?: CustomerContext,
  factSelection?: FactSelectionResult,
): string {
  const missingHint =
    analysis.nextBestAction === "ASK_MISSING_INFO" && analysis.missingFieldToAsk
      ? analysis.missingFieldToAsk
      : "none";
  const ctaWarmth =
    analysis.commercialScore >= 70 || analysis.urgency === "HIGH"
      ? "hot"
      : analysis.commercialScore >= 40
        ? "warm"
        : "cold";
  const topicKey = analysis.disclosureTopic ?? resolveDisclosureTopic(context?.lastServiceMentioned, analysis.intent);
  const ctaType = resolveCtaType(analysis, context ?? { interests: [] });
  const disclosureBlock =
    analysis.disclosureLevel > 0
      ? buildProgressiveDisclosureBlock({
          topicKey,
          level: analysis.disclosureLevel,
          language,
          nextLevel: analysis.progressive ? Math.min(4, analysis.disclosureLevel + 1) : undefined,
          forbiddenLevels: context?.disclosedSnippetsByTopic?.[topicKey],
          factSelection,
          questionFocus: analysis.questionFocus,
        })
      : "";
  const objectionBlock = buildObjectionGuidance(analysis.objections, language);
  const antiRepBlock = context
    ? buildAntiRepetitionBlock(context, topicKey, analysis.disclosureLevel, language)
    : "";
  const contactReady = Boolean(context?.name && context?.phone);
  const shared = `AGENT STATE (internal, do not mention to the user):
intent=${analysis.intent}
stage=${analysis.conversationStage}
score=${analysis.commercialScore}
nba=${analysis.nextBestAction}
ctaType=${ctaType}
urgency=${analysis.urgency}
ctaWarmth=${ctaWarmth}
contactSaved=${contactReady ? "yes" : "no"}
replyLanguage=${language}
missing=${analysis.missingInformation.join(",") || "none"}
askOnly=${missingHint}
disclosureTopic=${topicKey}
disclosureLevel=${analysis.disclosureLevel}
questionFocus=${analysis.questionFocus}
objections=${analysis.objections.join(",") || "none"}
Role: sales + support + qualification agent (not FAQ bot, not human).
Answer first when facts exist. One missing-info question max. Never re-ask known facts.
Use ONLY ALLOWED FACTS from PROGRESSIVE DISCLOSURE and VERIFIED KNOWLEDGE — paraphrase naturally; no invented details. Do not repeat previously disclosed fact IDs.
WhatsApp routing: read the full conversation — when the visitor wants to proceed, book, get a quote, complete a request, or speak with the team, end with a natural WhatsApp handoff (published link) if ctaType allows and they did not refuse WhatsApp. Do not push WhatsApp on pure info questions or while they are still exploring.
Cold= value first; warm+contactSaved= after a helpful answer, a soft WhatsApp invite is OK for quotes/booking; hot/urgent= direct WhatsApp if visitor did not refuse and ctaType allows.`;
  return [shared, disclosureBlock, objectionBlock, antiRepBlock].filter(Boolean).join("\n\n");
}

export function buildCompactAgentSummary(
  context: CustomerContext,
  analysis: AgentAnalysis,
): string {
  const topicKey =
    analysis.disclosureTopic ?? resolveDisclosureTopic(context.lastServiceMentioned, analysis.intent);
  const topicLevel = context.disclosureByTopic?.[topicKey] ?? analysis.disclosureLevel;
  const parts = [
    context.customerType ? `customer=${context.customerType}` : null,
    context.yachtLength ? `yacht=${context.yachtLength}` : null,
    context.location ? `location=${context.location}` : null,
    context.yachtType ? `type=${context.yachtType}` : null,
    context.lastServiceMentioned ? `service=${context.lastServiceMentioned}` : null,
    context.customerGoal ? `goal=${context.customerGoal}` : null,
    `stage=${analysis.conversationStage}`,
    `score=${analysis.commercialScore}`,
    `urgency=${analysis.urgency}`,
    `nba=${analysis.nextBestAction}`,
    analysis.objections.length ? `objections=${analysis.objections.join(",")}` : null,
    analysis.missingInformation.length
      ? `missing=${analysis.missingInformation.join(",")}`
      : null,
    `intent=${analysis.intent}`,
    topicLevel ? `disclosure=${topicKey}:${topicLevel}` : null,
  ].filter(Boolean);
  return parts.join("; ").slice(0, 900);
}
