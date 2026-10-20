import type { ChatLanguage } from "@/lib/chatbot/types";
import servicesFile from "@/data/chatbot/services.json";
import company from "@/data/chatbot/company.json";
import contact from "@/data/chatbot/contact.json";
import limitations from "@/data/chatbot/limitations.json";
import { getPublishedContactChannels } from "../contactChannels";

type Localized = { en: string; ar: string };

export type QuestionFocus =
  | "scope_overview"
  | "operational"
  | "pricing"
  | "comparison"
  | "owner_value"
  | "crew_detail"
  | "progressive_expand"
  | "general_service"
  | "contact_phone"
  | "contact_whatsapp"
  | "contact_form"
  | "contact_general"
  | "website_attribution"
  | "chatbot_identity"
  | "yacht_rental"
  | "yacht_need_ambiguous"
  | "casual_greeting";

export type AllowedFactKind = "theme" | "fact" | "summary" | "pricing" | "consultation";

export interface AllowedFact {
  id: string;
  text: string;
  kind: AllowedFactKind;
}

export interface FactSelectionResult {
  allowedFacts: AllowedFact[];
  allowedFactIds: string[];
  hiddenFactIds: string[];
  angleHint: string;
  reason: string;
  serviceId?: string;
  secondaryServiceIds?: string[];
}

const YM360_ORDER = [
  "ym360_feature_0",
  "ym360_feature_1",
  "ym360_feature_2",
  "ym360_benefit_0",
  "ym360_benefit_1",
  "ym360_benefit_2",
] as const;

const SERVICE_FACT_ORDER: Record<string, readonly string[]> = {
  "yacht-management-360": YM360_ORDER,
  "crew-management": [
    "cm_feature_0",
    "cm_feature_1",
    "cm_feature_2",
    "cm_benefit_0",
    "cm_benefit_1",
    "cm_benefit_2",
  ],
  "marina-management": [
    "mm_feature_0",
    "mm_feature_1",
    "mm_feature_2",
    "mm_benefit_0",
    "mm_benefit_1",
    "mm_benefit_2",
  ],
  "visiting-yacht-agency": [
    "vya_feature_0",
    "vya_feature_1",
    "vya_feature_2",
    "vya_benefit_0",
    "vya_benefit_1",
    "vya_benefit_2",
  ],
};

const SERVICE_VALUE_ORDER: Record<string, readonly string[]> = {
  "yacht-management-360": ["ym360_value_0", "ym360_value_1", "ym360_value_2"],
  "crew-management": ["cm_value_0", "cm_value_1", "cm_value_2"],
  "marina-management": ["mm_value_0", "mm_value_1", "mm_value_2"],
  "visiting-yacht-agency": ["vya_value_0", "vya_value_1", "vya_value_2"],
};

const FOCUS_FACT_GROUPS: Record<string, Partial<Record<QuestionFocus, readonly string[]>>> = {
  "yacht-management-360": {
    operational: ["ym360_benefit_0", "ym360_feature_0", "ym360_value_0"],
    owner_value: ["ym360_value_0", "ym360_value_1", "ym360_benefit_2"],
    crew_detail: ["ym360_value_0"],
    scope_overview: [],
  },
};

const L1_THEMES: Record<ChatLanguage, Array<{ id: string; text: string }>> = {
  ar: [
    { id: "theme_operational", text: "إدارة تشغيلية شاملة" },
    { id: "theme_technical", text: "إشراف فني وصيانة مخططة" },
    { id: "theme_financial", text: "متابعة مالية وتقارير تكاليف" },
    { id: "theme_compliance", text: "امتثال بحري وتنسيق الطاقم" },
  ],
  en: [
    { id: "theme_operational", text: "Integrated operational oversight" },
    { id: "theme_technical", text: "Technical supervision and planned maintenance" },
    { id: "theme_financial", text: "Financial oversight and OPEX reporting" },
    { id: "theme_compliance", text: "Maritime compliance and crew coordination" },
  ],
};

function loc(value: Localized, language: ChatLanguage): string {
  return language === "ar" ? value.ar : value.en;
}

function findService(serviceId: string) {
  return servicesFile.services.find((s) => s.id === serviceId);
}

function buildFactTextMap(serviceId: string, language: ChatLanguage): Map<string, string> {
  const service = findService(serviceId);
  const map = new Map<string, string>();
  if (!service) return map;
  const order = SERVICE_FACT_ORDER[serviceId];
  const lang = language === "ar" ? "ar" : "en";
  if (order) {
    order.forEach((id, index) => {
      const text = service.includes[lang][index];
      if (text) map.set(id, text);
    });
  }
  const valueOrder = SERVICE_VALUE_ORDER[serviceId];
  const values = service.values?.[lang] ?? [];
  if (valueOrder) {
    valueOrder.forEach((id, index) => {
      const value = values[index];
      if (value?.title) {
        map.set(id, `${value.title}: ${value.description}`.trim());
      }
    });
  }
  if (service.intro?.[lang]) {
    map.set(`intro_${serviceId}`, service.intro[lang]);
  }
  if (service.detailBody?.[lang]) {
    map.set(`detail_${serviceId}`, service.detailBody[lang]);
  }
  return map;
}

function allFactIdsForService(serviceId: string): string[] {
  return [...(SERVICE_FACT_ORDER[serviceId] ?? []), ...(SERVICE_VALUE_ORDER[serviceId] ?? [])];
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

export function detectWhatsAppRequest(message: string): boolean {
  const text = normalize(message);
  return /واتس|whatsapp|watsp|wa\.me/.test(text);
}

export function detectPhoneRequest(message: string): boolean {
  const text = normalize(message);
  if (detectWhatsAppRequest(message)) return false;
  return /(?:^|\s)(?:ممكن\s*)?رقم\s*(?:ال)?(?:هاتف|جوال|اتصال|تواصل)|(?:^|\s)(?:phone|call)\s*(?:number)?|(?:^|\s)(?:voice|direct)\s*phone|(?:^|\s)(?:في|فيه)\s*رقم\s*(?:اتصال|هاتف|تواصل)|(?:^|\s)(?:مفيش|ما\s*في|لا\s*يوجد)\s*رقم|(?:^|\s)no\s*phone|(?:^|\s)is\s*there\s*(?:a\s*)?(?:phone|number)|(?:^|\s)contact\s*number/.test(
    text,
  );
}

export function detectWebsiteAttribution(message: string): boolean {
  const text = normalize(message);
  return /مين\s*(?:عمل|مصمم|نفذ|طور|برمج|صمم)|(?:ال)?(?:موقع|شات\s*بوت|chatbot)\s*(?:من\s*)?(?:تنفيذ|عمل)|(?:ال)?(?:شركة|وكالة)\s*(?:اللي\s*)?(?:عملت|نفذت|طورت)|who\s*(?:built|developed|designed|created)|which\s*(?:company|agency)\s*(?:built|developed)|(?:built|developed|designed|created)\s*(?:this\s*)?(?:website|site|chatbot)|top\s*1\s*markt|top1markt/.test(
    text,
  );
}

const AR_YOU = /(?:انت|إنت|أنت)/;

function asksWhoAreYou(text: string): boolean {
  return new RegExp(`(?:^|\\s)${AR_YOU.source}\\s*مين`).test(text) || /(?:^|\s)who\s*are\s*you/.test(text);
}

function asksAssistantOrCaptain(text: string): boolean {
  return (
    /(?:^|\s)مين\s*(?:المساعد|الكابتن(?:\s*المساعد)?)/.test(text) ||
    /(?:^|\s)(?:assistant\s*)?captain\b/.test(text) ||
    /(?:^|\s)الكابتن\s*المساعد/.test(text)
  );
}

function asksIfAiOrBot(text: string): boolean {
  return (
    new RegExp(`(?:^|\\s)(?:هل\\s*)?${AR_YOU.source}\\s*(?:ai|ذكاء\\s*اصطناعي|روبوت|بوت)`).test(text) ||
    /(?:^|\s)are\s*you\s*(?:ai|a\s*bot|human)/.test(text)
  );
}

function mentionsChatbot(text: string): boolean {
  return (
    /(?:^|\s)شات\s*بوت(?:\s|$|[?.!،])/.test(text) ||
    /(?:^|\s)chatbot(?:\s|$|[?.!])/i.test(text)
  );
}

export function detectChatbotIdentity(message: string): boolean {
  const text = normalize(message);
  return (
    asksWhoAreYou(text) ||
    asksAssistantOrCaptain(text) ||
    asksIfAiOrBot(text) ||
    mentionsChatbot(text)
  );
}

export function detectYachtRental(message: string): boolean {
  const text = normalize(message);
  return /(?:^|\s)(?:تأجير|تاجير|ايجار|إيجار|charter|rent(?:al)?|rent a yacht)/.test(text) && /(?:يخت|yacht|boat|قارب)/.test(text);
}

export function detectAmbiguousYachtNeed(message: string): boolean {
  const text = normalize(message);
  if (detectYachtRental(message)) return false;
  if (/شراء|بيع|buy|purchase|sell|own|أملك|عندي\s*يخت/.test(text) && /(?:إدارة|manage|ادير|management)/.test(text)) {
    return false;
  }
  return /(?:^|\s)(?:محتاج|ابغى|ابي|عايز|أحتاج|need|want)\s*(?:يخت|yacht|boat|قارب)/.test(text);
}

export function detectCasualGreeting(message: string): boolean {
  const text = normalize(message);
  return /(?:^|\s)(?:ازيك|ازي|إزيك|كيف\s*حال|شلون|how\s*are\s*you|what'?s\s*up|sup\b|hello\s*again|hi\s*again|مرحبا\s*مرة|هلا\s*مرة)/.test(text);
}

/** Focuses that require fact selection even when disclosure topic is general. */
export const GENERAL_TOPIC_FACT_FOCUSES = new Set<QuestionFocus>([
  "contact_phone",
  "contact_whatsapp",
  "contact_form",
  "contact_general",
  "website_attribution",
  "chatbot_identity",
  "yacht_rental",
  "yacht_need_ambiguous",
  "casual_greeting",
  "general_service",
]);

/** Deterministic question focus — takes precedence over stale disclosure level for content plane. */
export function resolveQuestionFocus(message: string, intent?: string): QuestionFocus {
  const text = normalize(message);

  if (detectPhoneRequest(message)) return "contact_phone";
  if (detectWhatsAppRequest(message)) return "contact_whatsapp";
  if (/contact form|نموذج|استمارة|application form|submit inquiry/.test(text)) return "contact_form";
  if (detectWebsiteAttribution(message)) return "website_attribution";
  if (detectChatbotIdentity(message)) return "chatbot_identity";
  if (detectYachtRental(message) || intent === "YACHT_RENTAL") return "yacht_rental";
  if (detectAmbiguousYachtNeed(message) || intent === "YACHT_CLARIFY") return "yacht_need_ambiguous";
  if (detectCasualGreeting(message) || intent === "GREETING") return "casual_greeting";

  if (/ناحية التشغيل|من ناحية التشغيل|تشغيلي|day-to-day|operational|daily operations/.test(text)) {
    return "operational";
  }
  if (/بكم|السعر|التكلفة|price|how much|cost\b|pricing/.test(text)) return "pricing";
  if (/الفرق|مقارنة|compare|\bvs\b|versus|difference between/.test(text)) return "comparison";
  if (/كيف تساعدون|كيف تفيدون|help yacht owners|help owners|owner benefits/.test(text)) {
    return "owner_value";
  }
  if (/طاقم|crew\b|crew management/.test(text) && !/إدارة اليخت|yacht management 360|yacht-management/.test(text)) {
    return "crew_detail";
  }
  if (/وش بعد|وايش بعد|تفاصيل أكثر|تفاصيل اكتر|show more|more details|what else|tell me more|وبعدين/.test(text)) {
    return "progressive_expand";
  }
  if (/وش تشمل|وش تتضمن|ماذا تشمل|what includes|what does .* include|includes\b|scope of|نطاق/.test(text)) {
    return "scope_overview";
  }
  if (intent === "SERVICES" || /خدمات|what services|what do you offer/.test(text)) return "general_service";
  if (intent === "CONTACT") return "contact_general";
  return "general_service";
}

function pickUndisclosed(
  orderedIds: readonly string[],
  disclosed: Set<string>,
  limit: number,
  prefer?: readonly string[],
): string[] {
  const picked: string[] = [];
  if (prefer?.length) {
    for (const id of prefer) {
      if (picked.length >= limit) break;
      if (!disclosed.has(id) && orderedIds.includes(id)) picked.push(id);
    }
  }
  for (const id of orderedIds) {
    if (picked.length >= limit) break;
    if (!disclosed.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked.slice(0, limit);
}

function factEntries(ids: string[], textMap: Map<string, string>): AllowedFact[] {
  return ids
    .filter((id) => textMap.has(id))
    .map((id) => ({ id, text: textMap.get(id)!, kind: "fact" as const }));
}

function levelBudget(level: number, focus: QuestionFocus): number {
  if (level <= 1) return focus === "scope_overview" ? 4 : 4;
  if (level === 2) return 4;
  if (level === 3) return 5;
  return 3;
}

export interface SelectAllowedFactsInput {
  serviceId: string;
  disclosureLevel: number;
  questionFocus: QuestionFocus;
  intent: string;
  disclosedFactIds: string[];
  language: ChatLanguage;
  message: string;
  secondaryServiceIds?: string[];
}

export function selectAllowedFacts(input: SelectAllowedFactsInput): FactSelectionResult {
  const {
    serviceId,
    disclosureLevel,
    questionFocus,
    intent,
    disclosedFactIds,
    language,
    secondaryServiceIds = [],
  } = input;

  const level = Math.max(0, Math.min(4, disclosureLevel));
  const disclosed = new Set(disclosedFactIds);
  const service = findService(serviceId);
  const textMap = buildFactTextMap(serviceId, language);
  const allIds = allFactIdsForService(serviceId);
  const budget = levelBudget(level, questionFocus);
  const focusGroup = FOCUS_FACT_GROUPS[serviceId]?.[questionFocus];

  if (questionFocus === "contact_phone") {
    const channels = getPublishedContactChannels(language);
    const allowedFacts: AllowedFact[] = [
      {
        id: "contact_phone_display",
        text: `${channels.phone.label}: ${channels.phone.display}`,
        kind: "summary",
      },
      {
        id: "contact_phone_available",
        text:
          language === "ar"
            ? "يتوفر رقم اتصال هاتفي منشور على الموقع للمكالمات الصوتية."
            : "A published direct phone number is available on the website for voice calls.",
        kind: "summary",
      },
      {
        id: "contact_email",
        text: `${language === "ar" ? "البريد" : "Email"}: ${channels.email}`,
        kind: "summary",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: [],
      angleHint:
        language === "ar"
          ? "أعطِ رقم الهاتف المنشور للاتصال الصوتي. لا تقل إن الرقم غير متوفر. لا تستبدل الهاتف برابط واتساب إلا إذا طلب الزائر واتساب صراحة."
          : "Give the published direct phone number for voice calls. Never say no phone is available. Do not replace phone with WhatsApp unless the visitor explicitly asked for WhatsApp.",
      reason: "contact_phone",
    };
  }

  if (questionFocus === "contact_whatsapp") {
    const channels = getPublishedContactChannels(language);
    const allowedFacts: AllowedFact[] = [
      {
        id: "contact_whatsapp_url",
        text: `${channels.whatsapp.label}: ${channels.whatsapp.url}`,
        kind: "summary",
      },
      {
        id: "contact_whatsapp_number",
        text: `${language === "ar" ? "رقم واتساب" : "WhatsApp number"}: ${channels.whatsapp.display}`,
        kind: "summary",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: [],
      angleHint:
        language === "ar"
          ? "قدّم رابط واتساب المنشور في سطر مستقل. واتساب للمراسلة — ليس بالضرورة بديلاً عن الهاتف الصوتي."
          : "Provide the published WhatsApp link on its own line. WhatsApp is for messaging — not necessarily a substitute for voice phone.",
      reason: "contact_whatsapp",
    };
  }

  if (questionFocus === "contact_form") {
    const channels = getPublishedContactChannels(language);
    const allowedFacts: AllowedFact[] = [
      {
        id: "contact_form_url",
        text: `${channels.contactForm.label}: ${channels.contactForm.url}`,
        kind: "summary",
      },
      {
        id: "contact_email",
        text: `${language === "ar" ? "البريد" : "Email"}: ${channels.email}`,
        kind: "summary",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: [],
      angleHint: "Point to the published contact form or email.",
      reason: "contact_form",
    };
  }

  if (questionFocus === "contact_general") {
    const channels = getPublishedContactChannels(language);
    const allowedFacts: AllowedFact[] = [
      {
        id: "contact_phone_display",
        text: `${channels.phone.label}: ${channels.phone.display}`,
        kind: "summary",
      },
      {
        id: "contact_whatsapp_url",
        text: `${channels.whatsapp.label}: ${channels.whatsapp.url}`,
        kind: "summary",
      },
      {
        id: "contact_form_url",
        text: `${channels.contactForm.label}: ${channels.contactForm.url}`,
        kind: "summary",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: [],
      angleHint:
        language === "ar"
          ? "ميّز بين الهاتف الصوتي وواتساب ونموذج التواصل حسب ما يناسب سؤال الزائر."
          : "Distinguish voice phone, WhatsApp, and contact form as appropriate to the question.",
      reason: "contact_general",
    };
  }

  if (questionFocus === "website_attribution") {
    const impl = company.websiteImplementation;
    const allowedFacts: AllowedFact[] = [
      {
        id: "website_agency",
        text: `${language === "ar" ? "تنفيذ الموقع والشات بوت" : "Website and chatbot implementation"}: ${impl.agency}`,
        kind: "summary",
      },
      {
        id: "website_agency_url",
        text: `${language === "ar" ? "الموقع الرسمي" : "Official website"}: ${impl.websiteUrl}`,
        kind: "summary",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: [],
      angleHint:
        language === "ar"
          ? "حدّد Top1Markting كمنفّذ الموقع/الشات بوت عند السؤال. لا تختلق تفاصيل عن الشركة غير المنشورة."
          : "Identify Top1Markting as the website/chatbot implementer when asked. Do not invent unsupported agency details.",
      reason: "website_attribution",
    };
  }

  if (questionFocus === "chatbot_identity") {
    const assistantName = loc(company.assistantName, language);
    const allowedFacts: AllowedFact[] = [
      {
        id: "assistant_identity",
        text:
          language === "ar"
            ? `${assistantName} — المساعد الذكي (AI) لـ ${company.name}. لست موظفاً بشرياً.`
            : `${assistantName} — the AI assistant for ${company.name}. Not a human employee.`,
        kind: "summary",
      },
      {
        id: "assistant_role",
        text: loc(company.description, language),
        kind: "summary",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: [],
      angleHint:
        language === "ar"
          ? "عرّف نفسك باختصار كمساعد ذكي للمارينا. لا تدّعِ أنك إنسان."
          : "Briefly identify as the marina AI assistant. Do not claim to be human.",
      reason: "chatbot_identity",
    };
  }

  if (questionFocus === "yacht_rental") {
    const allowedFacts: AllowedFact[] = [
      {
        id: "yacht_rental_not_listed",
        text: loc(limitations.yachtRentalNotListed, language),
        kind: "summary",
      },
    ];
    for (const svc of servicesFile.services.slice(0, 3)) {
      allowedFacts.push({
        id: `summary_${svc.id}`,
        text: `${loc(svc.title, language)}: ${loc(svc.summary, language)}`,
        kind: "summary",
      });
    }
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: Object.values(SERVICE_FACT_ORDER).flat(),
      angleHint:
        language === "ar"
          ? "وضّح أن تأجير اليخوت ليس خدمة منشورة. اعرض الخدمات الفعلية بلطف دون اختلاق أسعار أو توفر."
          : "Clarify yacht rental is not a published service. Gently guide to actual services without inventing prices or availability.",
      reason: "yacht_rental",
    };
  }

  if (questionFocus === "yacht_need_ambiguous") {
    const allowedFacts: AllowedFact[] = servicesFile.services.map((svc) => ({
      id: `summary_${svc.id}`,
      text: `${loc(svc.title, language)}: ${loc(svc.summary, language)}`,
      kind: "summary",
    }));
    allowedFacts.unshift({
      id: "yacht_need_clarify",
      text:
        language === "ar"
          ? "احتياجك قد يكون إدارة يخت، طاقم، وكالة زيارة، أو مارينا — أو استفسار عن تأجير (غير منشور)."
          : "Your need may be yacht management, crew, visiting agency, marina — or rental (not published).",
      kind: "summary",
    });
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: Object.values(SERVICE_FACT_ORDER).flat(),
      angleHint:
        language === "ar"
          ? "اسأل سؤال توضيح واحد مفيد: هل تقصد إدارة يختك، تأجير لرحلة، أم خدمة أخرى؟ لا ترد بعبارة عامة عن الخدمات التشغيلية."
          : "Ask ONE useful clarifying question: management, charter/rental, or another service? Avoid generic operational-services prompts.",
      reason: "yacht_need_ambiguous",
    };
  }

  if (questionFocus === "casual_greeting") {
    const assistantName = loc(company.assistantName, language);
    const allowedFacts: AllowedFact[] = [
      {
        id: "greeting_persona",
        text: `${assistantName} — ${loc(company.tagline, language)}`,
        kind: "theme",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: Object.values(SERVICE_FACT_ORDER).flat(),
      angleHint:
        language === "ar"
          ? "ردّ بترحيب قصير وطبيعي. إذا وُجد lastCasualGreetingReply في ANTI-REPETITION، غيّر الصياغة — لا تكرر نفس الجملة حرفياً."
          : "Reply with a short natural greeting. If lastCasualGreetingReply is in ANTI-REPETITION, vary wording — do not repeat the exact same sentence.",
      reason: "casual_greeting",
    };
  }

  // Comparison — two service summaries only
  if (questionFocus === "comparison") {
    const services = [serviceId, ...secondaryServiceIds].filter(Boolean).slice(0, 2);
    const allowedFacts: AllowedFact[] = [];
    for (const sid of services) {
      const svc = findService(sid);
      if (!svc) continue;
      allowedFacts.push({
        id: `summary_${sid}`,
        text: loc(svc.summary, language),
        kind: "summary",
      });
    }
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds,
      angleHint: "Contrast the two services by purpose and scope in your own words.",
      reason: "comparison_focus",
      serviceId,
      secondaryServiceIds: services.slice(1),
    };
  }

  // Multi-service overview
  if (questionFocus === "general_service" && (intent === "SERVICES" || level <= 1)) {
    const allowedFacts: AllowedFact[] = servicesFile.services.map((svc) => ({
      id: `summary_${svc.id}`,
      text: `${loc(svc.title, language)}: ${loc(svc.summary, language)}`,
      kind: "summary",
    }));
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: Object.values(SERVICE_FACT_ORDER).flat(),
      angleHint: "Give a concise overview of published services; do not list every bullet.",
      reason: "services_overview",
    };
  }

  // Crew detail on crew service
  if (questionFocus === "crew_detail" || serviceId === "crew-management") {
    const ids = pickUndisclosed(SERVICE_FACT_ORDER["crew-management"] ?? [], disclosed, budget);
    const allowedFacts = factEntries(ids, buildFactTextMap("crew-management", language));
    if (service && allowedFacts.length === 0) {
      allowedFacts.push({ id: `summary_${serviceId}`, text: loc(service.summary, language), kind: "summary" });
    }
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: (SERVICE_FACT_ORDER["crew-management"] ?? []).filter((id) => !ids.includes(id)),
      angleHint: "Explain crew services naturally using only allowed facts.",
      reason: "crew_detail",
      serviceId: "crew-management",
    };
  }

  // Pricing focus — overrides stale L3 pricing plane
  if (questionFocus === "pricing" || intent.includes("PRICING")) {
    const allowedFacts: AllowedFact[] = [
      {
        id: "price_not_published",
        text: loc(limitations.priceNotPublished, language),
        kind: "pricing",
      },
    ];
    if (service) {
      allowedFacts.unshift({
        id: `pricing_model_${serviceId}`,
        text: loc(service.pricingLabel, language),
        kind: "pricing",
      });
    }
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds,
      angleHint: "Explain pricing context without inventing numbers.",
      reason: "pricing_focus",
      serviceId,
    };
  }

  // Operational focus — overrides accumulated level
  if (questionFocus === "operational") {
    const prefer = FOCUS_FACT_GROUPS[serviceId]?.operational ?? [];
    const ids = pickUndisclosed(allIds, disclosed, budget, prefer);
    const allowedFacts = factEntries(ids, textMap);
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds.filter((id) => !ids.includes(id)),
      angleHint: "Focus on operational/day-to-day aspects only.",
      reason: "operational_focus",
      serviceId,
    };
  }

  // Owner value angle
  if (questionFocus === "owner_value") {
    const prefer = FOCUS_FACT_GROUPS[serviceId]?.owner_value ?? [];
    const ids = pickUndisclosed(allIds, disclosed, budget, prefer);
    const themes = L1_THEMES[language].slice(0, 2);
    const allowedFacts: AllowedFact[] = [
      ...(service
        ? [{ id: `summary_${serviceId}`, text: loc(service.summary, language), kind: "summary" as const }]
        : []),
      ...themes.map((t) => ({ ...t, kind: "theme" as const })),
      ...factEntries(ids, textMap),
    ].slice(0, budget + 1);
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds.filter((id) => !ids.includes(id)),
      angleHint: "Explain owner benefits and peace of mind; not a full checklist.",
      reason: "owner_value",
      serviceId,
    };
  }

  // L4 consultation
  if (level >= 4) {
    const allowedFacts: AllowedFact[] = [
      {
        id: "price_not_published",
        text: loc(limitations.priceNotPublished, language),
        kind: "pricing",
      },
      {
        id: "consultation_paths",
        text:
          language === "ar"
            ? `للاستشارة: ${contact.urls.application} أو ${contact.email}`
            : `For consultation: ${contact.urls.application} or ${contact.email}`,
        kind: "consultation",
      },
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds,
      angleHint: "Offer consultation/handoff naturally without pressure.",
      reason: "L4_consultation",
      serviceId,
    };
  }

  // L1 scope overview — themes only, NO includes[] and NO dense summary sentence
  if (level <= 1 && questionFocus === "scope_overview") {
    const themes = L1_THEMES[language].slice(0, 4);
    const allowedFacts: AllowedFact[] = [
      ...(service
        ? [{ id: `title_${serviceId}`, text: loc(service.title, language), kind: "summary" as const }]
        : []),
      ...themes.map((t) => ({ ...t, kind: "theme" as const })),
    ];
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds,
      angleHint:
        language === "ar"
          ? "أجب بنظرة عامة طبيعية — لا تسرد قائمة كاملة بكل البنود."
          : "Answer with a natural overview — do not enumerate the full checklist.",
      reason: "L1_scope_overview",
      serviceId,
    };
  }

  // L2 / progressive_expand — next undisclosed facts
  if (level === 2 || questionFocus === "progressive_expand") {
    const ids = pickUndisclosed(allIds, disclosed, budget, focusGroup);
    const allowedFacts = factEntries(ids, textMap);
    if (allowedFacts.length === 0 && service) {
      allowedFacts.push({
        id: `summary_${serviceId}`,
        text: loc(service.summary, language),
        kind: "summary",
      });
    }
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds.filter((id) => !ids.includes(id)),
      angleHint: "Introduce only the new allowed facts; do not repeat prior themes.",
      reason: "L2_progressive",
      serviceId,
    };
  }

  // L3 — next facts OR pricing only if pricing intent (handled above)
  if (level === 3) {
    const ids = pickUndisclosed(allIds, disclosed, budget, focusGroup);
    const allowedFacts = factEntries(ids, textMap);
    return {
      allowedFacts,
      allowedFactIds: allowedFacts.map((f) => f.id),
      hiddenFactIds: allIds.filter((id) => !ids.includes(id)),
      angleHint: "Add deeper detail from allowed facts only.",
      reason: "L3_detail",
      serviceId,
    };
  }

  // Default L1 general — prefer site intro when available for richer first answers
  const themes = L1_THEMES[language].slice(0, 3);
  const introText = service ? textMap.get(`intro_${serviceId}`) : undefined;
  const allowedFacts: AllowedFact[] = [
    ...(service
      ? [
          {
            id: introText ? `intro_${serviceId}` : `summary_${serviceId}`,
            text: introText || loc(service.summary, language),
            kind: "summary" as const,
          },
        ]
      : []),
    ...themes.map((t) => ({ ...t, kind: "theme" as const })),
  ];
  return {
    allowedFacts,
    allowedFactIds: allowedFacts.map((f) => f.id),
    hiddenFactIds: allIds,
    angleHint:
      language === "ar"
        ? "قدّم نظرة عامة من معرفة الموقع ثم ادعُ لسؤال أعمق إن لزم."
        : "Give a site-grounded overview, then invite a deeper question if needed.",
    reason: "L1_default",
    serviceId,
  };
}

/** IDs exposed this turn that should be remembered (excludes hidden-only markers). */
export function factIdsToRecord(selection: FactSelectionResult): string[] {
  return selection.allowedFactIds.filter((id) => !id.startsWith("title_"));
}

export function getAllServiceFactTexts(serviceId: string, language: ChatLanguage): string[] {
  const map = buildFactTextMap(serviceId, language);
  return [...map.values()];
}

/** Published KB prose for facts that must not appear in Gemini payload this turn. */
export function getHiddenFactProse(
  selection: FactSelectionResult,
  language: ChatLanguage,
): string[] {
  const texts = new Set<string>();
  for (const id of selection.hiddenFactIds) {
    for (const sid of Object.keys(SERVICE_FACT_ORDER)) {
      const text = buildFactTextMap(sid, language).get(id);
      if (text && text.length >= 12) texts.add(text);
    }
  }
  return [...texts];
}
