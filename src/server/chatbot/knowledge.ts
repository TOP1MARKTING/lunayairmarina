import type { ChatLanguage } from "@/lib/chatbot/types";
import { getPublishedContactChannels } from "./contactChannels";
import faqKnowledge from "@/data/chatbot-knowledge.json";
import company from "@/data/chatbot/company.json";
import contact from "@/data/chatbot/contact.json";
import locations from "@/data/chatbot/locations.json";
import limitations from "@/data/chatbot/limitations.json";
import servicesFile from "@/data/chatbot/services.json";
import { resolveDisclosureTopic } from "./agent/progressiveDisclosure";
import type { FactSelectionResult } from "./agent/factSelection";
import { getHiddenFactProse } from "./agent/factSelection";

type Localized = { en: string; ar: string };

export interface ComposeKnowledgeOptions {
  intent?: string;
  disclosureTopic?: string;
  lastServiceMentioned?: string;
  needsContact?: boolean;
  needsPricing?: boolean;
  factSelection?: FactSelectionResult;
}

function loc(value: Localized, language: ChatLanguage): string {
  return language === "ar" ? value.ar : value.en;
}

function verifiedFactsPayload(language: ChatLanguage) {
  const lang = language === "ar" ? "ar" : "en";
  return {
    company: {
      name: company.name,
      persona: company.persona,
      assistantName: loc(company.assistantName, lang),
      tagline: loc(company.tagline, lang),
      founded: company.founded,
      description: loc(company.description, lang),
      mission: loc(company.mission, lang),
      vision: loc(company.vision, lang),
      websiteImplementation: {
        agency: company.websiteImplementation.agency,
        websiteUrl: company.websiteImplementation.websiteUrl,
        scope: loc(company.websiteImplementation.scope, lang),
      },
      stats: {
        yachtsManaged: company.stats.yachtsManaged,
        yachtsManagedLabel: loc(company.stats.yachtsManagedLabel, lang),
        partners: company.stats.partners,
        responseMinutes: company.stats.responseMinutes,
      },
    },
    locations: {
      headquarters: {
        city: loc(locations.headquarters.city, lang),
        country: loc(locations.headquarters.country, lang),
      },
      coverage: loc(locations.coverageNote, lang),
      regions: locations.regions.map((region) => loc({ en: region.en, ar: region.ar }, lang)),
    },
    services: servicesFile.services.map((service) => ({
      id: service.id,
      title: loc(service.title, lang),
      summary: loc(service.summary, lang),
      intro: loc(service.intro, lang),
      detailBody: loc(service.detailBody, lang),
      includes: service.includes[lang],
      benefits: service.benefits[lang],
      values: service.values[lang].map((item) => `${item.title}: ${item.description}`),
      pricingLabel: loc(service.pricingLabel, lang),
    })),
    contact: (() => {
      const channels = getPublishedContactChannels(lang);
      return {
        phoneDisplay: channels.phone.display,
        phoneVoice: channels.phone.display,
        whatsappUrl: channels.whatsapp.url,
        whatsappNumber: channels.whatsapp.display,
        email: channels.email,
        address: loc(contact.address, lang),
        hours: loc(contact.conciergeHours, lang),
        urls: contact.urls,
        social: contact.social,
        channels: {
          phone: {
            display: channels.phone.display,
            purpose: channels.phone.label,
          },
          whatsapp: {
            display: channels.whatsapp.display,
            url: channels.whatsapp.url,
            purpose: channels.whatsapp.label,
          },
          contactForm: {
            url: channels.contactForm.url,
            purpose: channels.contactForm.label,
          },
        },
      };
    })(),
    limitations: {
      priceNotPublished: loc(limitations.priceNotPublished, lang),
      berthNotPublished: loc(limitations.berthNotPublished, lang),
      yachtRentalNotListed: loc(limitations.yachtRentalNotListed, lang),
      purchaseSaleOutOfScope: loc(limitations.purchaseSaleOutOfScope, lang),
      fleetDemoNote: loc(limitations.fleetDemoNote, lang),
    },
    faq: faqKnowledge.faq.map((item) => ({
      question: item.question[lang],
      answer: item.answer[lang],
    })),
  };
}

function resolveServiceId(options?: ComposeKnowledgeOptions): string | undefined {
  if (options?.lastServiceMentioned) return options.lastServiceMentioned;
  if (options?.disclosureTopic && options.disclosureTopic !== "general") {
    return options.disclosureTopic;
  }
  return resolveDisclosureTopic(undefined, options?.intent);
}

function intentNeedsLocation(intent?: string): boolean {
  return Boolean(intent && /LOCATION|MARINA|VISITING|GENERAL|SERVICES|GREETING/.test(intent));
}

function intentNeedsAllServices(intent?: string): boolean {
  return Boolean(intent && /SERVICES|GREETING|GENERAL|REPAIR|OUT_OF_SCOPE/.test(intent));
}

function intentNeedsContact(intent?: string, options?: ComposeKnowledgeOptions): boolean {
  if (options?.needsContact) return true;
  return Boolean(
    intent &&
      /CONTACT|WHATSAPP|HANDOFF|WEBSITE_ATTRIBUTION|CHATBOT_IDENTITY|YACHT_RENTAL|YACHT_CLARIFY/.test(intent),
  );
}

function intentNeedsPricing(intent?: string, options?: ComposeKnowledgeOptions): boolean {
  if (options?.needsPricing) return true;
  return Boolean(intent && /PRICING|OBJECTION/.test(intent));
}

function intentNeedsCompanyDetail(intent?: string): boolean {
  return Boolean(
    intent &&
      /GENERAL|GREETING|SERVICES|REPAIR|OUT_OF_SCOPE|SECURITY|WEBSITE_ATTRIBUTION|CHATBOT_IDENTITY/.test(intent),
  );
}

/** Snippets used for verbatim detection (not sent as copy templates). */
export function getVerbatimCheckSources(
  language: ChatLanguage,
  options?: ComposeKnowledgeOptions,
): string[] {
  if (options?.factSelection) {
    return options.factSelection.allowedFacts
      .filter((f) => f.kind === "fact" || f.kind === "summary")
      .map((f) => f.text)
      .filter((s) => s.trim().length >= 30);
  }
  const facts = verifiedFactsPayload(language);
  const sources: string[] = [];
  const serviceId = resolveServiceId(options);
  if (serviceId && serviceId !== "general") {
    const svc = facts.services.find((s) => s.id === serviceId);
    if (svc) {
      sources.push(svc.summary);
    }
  } else {
    for (const svc of facts.services) {
      sources.push(svc.summary);
    }
  }
  sources.push(facts.limitations.priceNotPublished);
  return sources.filter((s) => s.trim().length >= 30);
}

function buildFactSelectionBlock(
  language: ChatLanguage,
  selection: FactSelectionResult,
  options?: ComposeKnowledgeOptions,
): Record<string, unknown> {
  const facts = verifiedFactsPayload(language);
  const block: Record<string, unknown> = {
    allowedFacts: selection.allowedFacts.map((f) => ({
      id: f.id,
      kind: f.kind,
      fact: f.text,
    })),
    factSelection: {
      reason: selection.reason,
      angleHint: selection.angleHint,
      allowedFactIds: selection.allowedFactIds,
    },
  };
  if (selection.serviceId) {
    const svc = facts.services.find((s) => s.id === selection.serviceId);
    if (svc) {
      block.service = { id: svc.id, title: svc.title };
    }
  }
  if (selection.secondaryServiceIds?.length) {
    block.comparisonServices = selection.secondaryServiceIds.map((id) => {
      const svc = facts.services.find((s) => s.id === id);
      return svc ? { id: svc.id, title: svc.title } : { id };
    });
  }
  if (intentNeedsPricing(options?.intent, options) || selection.allowedFacts.some((f) => f.kind === "pricing")) {
    block.limitations = {
      priceNotPublished: facts.limitations.priceNotPublished,
    };
  }
  if (intentNeedsContact(options?.intent, options)) {
    block.contact = facts.contact;
  }
  return block;
}

/** Strip hidden fact prose from retrieved website content when a fact budget is active. */
function filterRetrievedForFactBudget(
  retrieved: string,
  selection: FactSelectionResult,
  language: ChatLanguage,
): string {
  const hiddenProse = getHiddenFactProse(selection, language);
  if (!retrieved.trim() || !hiddenProse.length) return retrieved.trim();

  const allowedProse = new Set(
    selection.allowedFacts.filter((f) => f.kind === "fact").map((f) => f.text),
  );

  const filteredLines = retrieved.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    // Keep long site prose (intro/detail/benefits paragraphs); only strip short bullets matching hidden facts.
    if (trimmed.length > 90) return true;
    for (const hidden of hiddenProse) {
      if (trimmed.includes(hidden)) {
        for (const allowed of allowedProse) {
          if (trimmed.includes(allowed)) return true;
        }
        return false;
      }
    }
    return true;
  });

  return filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildSelectiveVerifiedBlock(
  language: ChatLanguage,
  options?: ComposeKnowledgeOptions,
): Record<string, unknown> {
  if (options?.factSelection) {
    return buildFactSelectionBlock(language, options.factSelection, options);
  }
  const facts = verifiedFactsPayload(language);
  if (!options) {
    return {
      company: facts.company,
      locations: facts.locations,
      services: facts.services.map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.summary,
      })),
      limitations: facts.limitations,
    };
  }
  const intent = options?.intent ?? "";
  const serviceId = resolveServiceId(options);
  const block: Record<string, unknown> = {
    company: intentNeedsCompanyDetail(intent)
      ? facts.company
      : { name: facts.company.name, tagline: facts.company.tagline },
  };

  if (intentNeedsLocation(intent) || /MARINA|VISITING/.test(intent)) {
    block.locations = facts.locations;
  }

  if (serviceId && serviceId !== "general") {
    block.services = facts.services
      .filter((s) => s.id === serviceId)
      .map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.summary,
        intro: s.intro,
        detailBody: s.detailBody,
        includes: s.includes,
        benefits: s.benefits,
        values: s.values,
      }));
  } else if (intentNeedsAllServices(intent)) {
    block.services = facts.services.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      intro: s.intro,
      includes: s.includes,
    }));
  } else if (/YACHT|CREW|MARINA|VISITING/.test(intent)) {
    const id = resolveDisclosureTopic(undefined, intent);
    if (id !== "general") {
      block.services = facts.services
        .filter((s) => s.id === id)
        .map((s) => ({
          id: s.id,
          title: s.title,
          summary: s.summary,
          intro: s.intro,
          detailBody: s.detailBody,
          includes: s.includes,
          benefits: s.benefits,
          values: s.values,
        }));
    }
  }

  if (intentNeedsContact(intent, options)) {
    block.contact = facts.contact;
  }

  if (intentNeedsPricing(intent, options)) {
    block.limitations = {
      priceNotPublished: facts.limitations.priceNotPublished,
      berthNotPublished: facts.limitations.berthNotPublished,
    };
    if (serviceId && serviceId !== "general") {
      const svc = facts.services.find((s) => s.id === serviceId);
      if (svc) block.pricingContext = { service: svc.id, pricingLabel: svc.pricingLabel };
    }
  }

  return block;
}

/** Compact verified Lunayair facts for retrieval fallback and Gemini grounding. */
export function getKnowledgeForLanguage(language: ChatLanguage): string {
  return JSON.stringify(verifiedFactsPayload(language), null, 2);
}

/**
 * Ground Gemini on relevant verified facts + retrieved website documents.
 * Sends a filtered KB slice per intent/topic — not the full ~10k payload every turn.
 */
export function composeGeminiKnowledge(
  language: ChatLanguage,
  retrievedKnowledge: string,
  options?: ComposeKnowledgeOptions,
): string {
  const selective = buildSelectiveVerifiedBlock(language, options);
  const styleNote =
    language === "ar"
      ? "ملاحظة: اعتمد على ALLOWED FACTS أولاً، واستخدم ADDITIONAL RETRIEVED WEBSITE KNOWLEDGE لإثراء التفاصيل المنشورة على الموقع. لا تخترع أسعاراً أو حقائق غير موجودة في هذه المصادر. أعد الصياغة محادثياً ولا تنسخ الجمل حرفياً."
      : "Note: Ground answers in ALLOWED FACTS first, and use ADDITIONAL RETRIEVED WEBSITE KNOWLEDGE to add published site detail. Do not invent prices or facts missing from these sources. Paraphrase naturally; do not copy sentences verbatim.";
  const verifiedBlock = JSON.stringify(selective, null, 2);
  let retrieved = retrievedKnowledge.trim();
  if (retrieved && options?.factSelection) {
    retrieved = filterRetrievedForFactBudget(retrieved, options.factSelection, language);
  }
  if (!retrieved) {
    if (options?.factSelection) {
      return `${styleNote}\n\n${verifiedBlock}`;
    }
    const facts = verifiedFactsPayload(language);
    const faqSlice =
      options?.intent && /PRICING|CONTACT|LOCATION/.test(options.intent)
        ? facts.faq.slice(0, 4)
        : facts.faq.slice(0, 2);
    return `${styleNote}\n\n${verifiedBlock}\n\nFAQ:\n${JSON.stringify(faqSlice, null, 2)}`;
  }
  return `${styleNote}\n\n${verifiedBlock}\n\n---\nADDITIONAL RETRIEVED WEBSITE KNOWLEDGE:\n${retrieved}`;
}

/** Approximate payload size for diagnostics. */
export function estimateKnowledgePayloadChars(
  language: ChatLanguage,
  retrievedKnowledge: string,
  options?: ComposeKnowledgeOptions,
): number {
  return composeGeminiKnowledge(language, retrievedKnowledge, options).length;
}
