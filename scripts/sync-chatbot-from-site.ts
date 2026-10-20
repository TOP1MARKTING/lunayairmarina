/**
 * Regenerates chatbot verified knowledge from site locales (EN + AR).
 * Source of truth: src/locales/{en,ar}.json — does not invent marketing copy.
 *
 * Run: npx tsx scripts/sync-chatbot-from-site.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Localized = { en: string; ar: string };
type LocaleFaq = { question: string; answer: string };
type LocaleServiceCard = {
  title: string;
  description: string;
  features?: string[];
  slug: string;
};
type LocaleServiceDetails = {
  title?: string;
  intro?: string;
  summary?: string;
  detailBody?: string;
  benefits?: string[];
  values?: Array<{ title?: string; description?: string }>;
  meta?: { investmentValue?: string };
};

const SERVICE_SLUGS = [
  "yacht-management-360",
  "visiting-yacht-agency",
  "marina-management",
  "crew-management",
] as const;

const PRICING_FALLBACK: Record<(typeof SERVICE_SLUGS)[number], Localized> = {
  "yacht-management-360": { en: "Custom package", ar: "باقة مخصصة" },
  "visiting-yacht-agency": { en: "Annual subscription", ar: "اشتراك سنوي" },
  "marina-management": { en: "Managed programme", ar: "برنامج إدارة" },
  "crew-management": { en: "Placement fee", ar: "رسوم التوظيف" },
};

const INTENT_IDS: Record<(typeof SERVICE_SLUGS)[number], string[]> = {
  "yacht-management-360": ["YACHT_MANAGEMENT", "YACHT_MANAGEMENT_360"],
  "visiting-yacht-agency": [
    "VISITING_YACHT_AGENCY",
    "VISITING_YACHT_CLEARANCE",
    "VISITING_YACHT_PERMITS",
  ],
  "marina-management": ["MARINA_MANAGEMENT", "MARINA_OPERATIONS", "BERTHING"],
  "crew-management": ["CREW_MANAGEMENT", "CREW_RECRUITMENT", "CREW_SALARIES", "CREW_TRAINING"],
};

function loadLocale(lang: "en" | "ar") {
  return JSON.parse(readFileSync(resolve(root, `src/locales/${lang}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

function writeJson(relPath: string, data: unknown) {
  const path = resolve(root, relPath);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`[sync-chatbot] wrote ${relPath}`);
}

function main() {
  const en = loadLocale("en");
  const ar = loadLocale("ar");

  const enServices = en.services as {
    items: LocaleServiceCard[];
    details: Record<string, LocaleServiceDetails>;
  };
  const arServices = ar.services as {
    items: LocaleServiceCard[];
    details: Record<string, LocaleServiceDetails>;
  };

  const services = SERVICE_SLUGS.map((slug) => {
    const enCard = enServices.items.find((item) => item.slug === slug);
    const arCard = arServices.items.find((item) => item.slug === slug);
    const enDetails = enServices.details[slug] ?? {};
    const arDetails = arServices.details[slug] ?? {};

    // Prefer card features, then enrich with benefits so progressive facts stay detailed.
    const includesEn = Array.from(
      new Set([...(enCard?.features ?? []), ...(enDetails.benefits ?? [])].filter(Boolean)),
    );
    const includesAr = Array.from(
      new Set([...(arCard?.features ?? []), ...(arDetails.benefits ?? [])].filter(Boolean)),
    );

    const pricingEn = enDetails.meta?.investmentValue || PRICING_FALLBACK[slug].en;
    const pricingAr = arDetails.meta?.investmentValue || PRICING_FALLBACK[slug].ar;

    return {
      id: slug,
      slug,
      title: {
        en: enDetails.title || enCard?.title || slug,
        ar: arDetails.title || arCard?.title || slug,
      },
      summary: {
        en: enDetails.summary || enCard?.description || "",
        ar: arDetails.summary || arCard?.description || "",
      },
      intro: {
        en: enDetails.intro || "",
        ar: arDetails.intro || "",
      },
      detailBody: {
        en: enDetails.detailBody || "",
        ar: arDetails.detailBody || "",
      },
      includes: {
        en: includesEn,
        ar: includesAr,
      },
      benefits: {
        en: enDetails.benefits ?? [],
        ar: arDetails.benefits ?? [],
      },
      values: {
        en: (enDetails.values ?? []).map((item) => ({
          title: item.title ?? "",
          description: item.description ?? "",
        })),
        ar: (arDetails.values ?? []).map((item) => ({
          title: item.title ?? "",
          description: item.description ?? "",
        })),
      },
      pricingLabel: { en: pricingEn, ar: pricingAr },
      intentIds: INTENT_IDS[slug],
    };
  });

  writeJson("src/data/chatbot/services.json", { services });

  const enFaq = ((en.faq as { items?: LocaleFaq[] })?.items ?? []).filter(
    (item) => item.question?.trim() && item.answer?.trim(),
  );
  const arFaq = ((ar.faq as { items?: LocaleFaq[] })?.items ?? []).filter(
    (item) => item.question?.trim() && item.answer?.trim(),
  );
  const faqCount = Math.min(enFaq.length, arFaq.length);
  const faq = Array.from({ length: faqCount }, (_, index) => ({
    question: { en: enFaq[index]!.question, ar: arFaq[index]!.question },
    answer: { en: enFaq[index]!.answer, ar: arFaq[index]!.answer },
  }));

  const enAbout = en.about as Record<string, unknown> | undefined;
  const arAbout = ar.about as Record<string, unknown> | undefined;
  const enWhy = en.why as { items?: Array<{ title: string; description: string }> } | undefined;
  const arWhy = ar.why as { items?: Array<{ title: string; description: string }> } | undefined;

  const existingKnowledge = JSON.parse(
    readFileSync(resolve(root, "src/data/chatbot-knowledge.json"), "utf8"),
  ) as Record<string, unknown>;

  const knowledge = {
    ...existingKnowledge,
    version: "1.1.0",
    updatedAt: new Date().toISOString().slice(0, 10),
    company: {
      en: {
        name: "Lunayair Marina",
        tagline: (en.brand as { tagline?: string })?.tagline || "Yacht Management",
        description:
          [typeof enAbout?.lead === "string" ? enAbout.lead : "", typeof enAbout?.body === "string" ? enAbout.body : ""]
            .filter(Boolean)
            .join(" ") ||
          (existingKnowledge.company as { en?: { description?: string } })?.en?.description ||
          "",
        location:
          (existingKnowledge.company as { en?: { location?: string } })?.en?.location ||
          "Based in Jeddah, serving yacht owners across Saudi Arabia and the Gulf.",
        regions: ["Jeddah", "Red Sea", "Arabian Gulf", "Saudi Arabia", "Gulf region"],
        mission:
          typeof enAbout?.mission === "object" && enAbout.mission && "body" in enAbout.mission
            ? String((enAbout.mission as { body?: string }).body ?? "")
            : "",
        vision:
          typeof enAbout?.vision === "object" && enAbout.vision && "body" in enAbout.vision
            ? String((enAbout.vision as { body?: string }).body ?? "")
            : "",
        story:
          typeof enAbout?.story === "object" && enAbout.story && "body" in enAbout.story
            ? String((enAbout.story as { body?: string }).body ?? "")
            : "",
        why: (enWhy?.items ?? []).map((item) => `${item.title}: ${item.description}`),
      },
      ar: {
        name: "Lunayair Marina",
        tagline: (ar.brand as { tagline?: string })?.tagline || "إدارة اليخوت",
        description:
          [typeof arAbout?.lead === "string" ? arAbout.lead : "", typeof arAbout?.body === "string" ? arAbout.body : ""]
            .filter(Boolean)
            .join(" ") ||
          (existingKnowledge.company as { ar?: { description?: string } })?.ar?.description ||
          "",
        location:
          (existingKnowledge.company as { ar?: { location?: string } })?.ar?.location ||
          "مقرنا في جدة، وندعم ملاك اليخوت في المملكة العربية السعودية ومنطقة الخليج.",
        regions: ["جدة", "البحر الأحمر", "الخليج العربي", "المملكة العربية السعودية", "منطقة الخليج"],
        mission:
          typeof arAbout?.mission === "object" && arAbout.mission && "body" in arAbout.mission
            ? String((arAbout.mission as { body?: string }).body ?? "")
            : "",
        vision:
          typeof arAbout?.vision === "object" && arAbout.vision && "body" in arAbout.vision
            ? String((arAbout.vision as { body?: string }).body ?? "")
            : "",
        story:
          typeof arAbout?.story === "object" && arAbout.story && "body" in arAbout.story
            ? String((arAbout.story as { body?: string }).body ?? "")
            : "",
        why: (arWhy?.items ?? []).map((item) => `${item.title}: ${item.description}`),
      },
    },
    services: services.map((service) => ({
      id: service.id,
      title: service.title,
      summary: service.summary,
      intro: service.intro,
      detailBody: service.detailBody,
      includes: service.includes,
      benefits: service.benefits,
    })),
    faq,
  };

  writeJson("src/data/chatbot-knowledge.json", knowledge);

  // Keep company.json mission/vision/description aligned with About when present.
  const companyPath = resolve(root, "src/data/chatbot/company.json");
  const company = JSON.parse(readFileSync(companyPath, "utf8")) as Record<string, unknown>;

  const aboutDescription = {
    en: [enAbout?.lead, enAbout?.body].filter(Boolean).join(" ") || "",
    ar: [arAbout?.lead, arAbout?.body].filter(Boolean).join(" ") || "",
  };
  if (aboutDescription.en || aboutDescription.ar) {
    company.description = {
      en: aboutDescription.en || (company.description as Localized).en,
      ar: aboutDescription.ar || (company.description as Localized).ar,
    };
  }

  const missionBody = {
    en:
      typeof enAbout?.mission === "object" && enAbout.mission && "body" in enAbout.mission
        ? String((enAbout.mission as { body?: string }).body ?? "")
        : "",
    ar:
      typeof arAbout?.mission === "object" && arAbout.mission && "body" in arAbout.mission
        ? String((arAbout.mission as { body?: string }).body ?? "")
        : "",
  };
  if (missionBody.en || missionBody.ar) {
    company.mission = {
      en: missionBody.en || (company.mission as Localized).en,
      ar: missionBody.ar || (company.mission as Localized).ar,
    };
  }

  const visionBody = {
    en:
      typeof enAbout?.vision === "object" && enAbout.vision && "body" in enAbout.vision
        ? String((enAbout.vision as { body?: string }).body ?? "")
        : "",
    ar:
      typeof arAbout?.vision === "object" && arAbout.vision && "body" in arAbout.vision
        ? String((arAbout.vision as { body?: string }).body ?? "")
        : "",
  };
  if (visionBody.en || visionBody.ar) {
    company.vision = {
      en: visionBody.en || (company.vision as Localized).en,
      ar: visionBody.ar || (company.vision as Localized).ar,
    };
  }
  writeJson("src/data/chatbot/company.json", company);

  console.log(
    `[sync-chatbot] synced ${services.length} services, ${faq.length} FAQ pairs from locales.`,
  );
}

main();
