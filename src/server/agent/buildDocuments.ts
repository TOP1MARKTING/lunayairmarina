import type { BlogPost } from "@/data/blogCore";
import { SERVICE_SLUGS } from "@/data/serviceSlugs";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  type AgentLanguage,
  type IngestionReport,
  type KnowledgeDocument,
} from "@/lib/agent/types";
import type { ServiceContent } from "@/types/content";
import {
  buildKnowledgeDocId,
  bulletLines,
  extractKeywords,
  flattenUnknown,
  formatSocialLinks,
  isPlaceholderTeamBio,
  isPlaceholderTrustCopy,
  joinSections,
  pickLocalized,
  socialKeywords,
} from "./normalize";
import { getLocaleSection, type KnowledgeSourceBundle } from "./loadSource";

function nowIso(): string {
  return new Date().toISOString();
}

function baseDoc(partial: Omit<KnowledgeDocument, "updatedAt" | "version">): KnowledgeDocument {
  return { ...partial, updatedAt: nowIso(), version: KNOWLEDGE_SCHEMA_VERSION };
}

function localeFaqItem(bundle: KnowledgeSourceBundle, language: AgentLanguage, index: number) {
  const items = getLocaleSection(bundle.locales, language, "faq.items") as
    Array<{ question: string; answer: string }> | undefined;
  return items?.[index] ?? null;
}

function localeServiceCard(bundle: KnowledgeSourceBundle, language: AgentLanguage, slug: string) {
  const items = getLocaleSection(bundle.locales, language, "services.items") as
    Array<{ title: string; description: string; features?: string[]; slug: string }> | undefined;
  return items?.find((entry) => entry.slug === slug) ?? null;
}

function localeServiceDetails(
  bundle: KnowledgeSourceBundle,
  language: AgentLanguage,
  slug: string,
) {
  const details = getLocaleSection(bundle.locales, language, `services.details.${slug}`);
  return details && typeof details === "object" ? (details as Record<string, unknown>) : null;
}

function buildServiceContent(
  language: AgentLanguage,
  slug: string,
  service: ServiceContent,
  card: ReturnType<typeof localeServiceCard>,
  details: Record<string, unknown> | null,
): string {
  const title = pickLocalized(service.title, language) || card?.title || slug;
  const description = pickLocalized(service.description, language) || card?.description || "";
  const features = service.features?.length
    ? service.features.map((item) => pickLocalized(item, language)).filter(Boolean)
    : (card?.features ?? []);

  const detailSections: string[] = [];
  if (details) {
    const intro = typeof details.intro === "string" ? details.intro : "";
    const summary = typeof details.summary === "string" ? details.summary : "";
    const detailBody = typeof details.detailBody === "string" ? details.detailBody : "";
    const benefits = Array.isArray(details.benefits)
      ? details.benefits.filter((item): item is string => typeof item === "string")
      : [];
    const values = Array.isArray(details.values)
      ? details.values
          .map((item) => {
            if (!item || typeof item !== "object") return "";
            const record = item as { title?: string; description?: string };
            return `${record.title ?? ""}: ${record.description ?? ""}`.trim();
          })
          .filter(Boolean)
      : [];

    detailSections.push(
      intro ? `Introduction:\n${intro}` : "",
      summary ? `Summary:\n${summary}` : "",
      detailBody ? `Detailed description:\n${detailBody}` : "",
      benefits.length ? `Benefits:\n${bulletLines(benefits)}` : "",
      values.length ? `Value propositions:\n${bulletLines(values)}` : "",
    );
  }

  return joinSections([
    `Service: ${title}`,
    description ? `Overview:\n${description}` : "",
    features.length ? `Key features:\n${bulletLines(features)}` : "",
    ...detailSections,
    "Note: Public pricing is not published. Contact the Lunayair team for a custom proposal.",
  ]);
}

function flattenBlogPost(post: BlogPost, language: AgentLanguage): string {
  const parts = [pickLocalized(post.excerpt, language)];
  for (const block of post.blocks ?? []) {
    if (block.type === "heading" || block.type === "quote") {
      parts.push(pickLocalized(block.text, language));
    } else if (block.type === "paragraph") {
      parts.push(block.spans.map((span) => pickLocalized(span.text, language)).join(" "));
    } else if (block.type === "image" && block.caption) {
      parts.push(pickLocalized(block.caption, language));
    }
  }
  return joinSections(parts);
}

function buildCompanyDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  const settings = bundle.settings;
  return (["en", "ar"] as const).map((language) => {
    const social = formatSocialLinks(settings.socialLinks, language);

    return baseDoc({
      id: buildKnowledgeDocId("company", "general", language),
      type: "company",
      language,
      title: settings.companyName || "Lunayair Marina",
      content: joinSections([
        `Company: ${settings.companyName || "Lunayair Marina"}`,
        `Phone: ${settings.phoneDisplay}`,
        `WhatsApp: ${settings.phoneDisplay}`,
        `Email: ${settings.email}`,
        `Address: ${pickLocalized(settings.address, language)}`,
        social ? `Social media & channels:\n${social}` : "",
        "Service area: Jeddah, Red Sea, Saudi Arabia, Gulf region",
      ]),
      source: "firestore",
      sourcePath: "settings/general",
      keywords: extractKeywords(
        settings.companyName,
        settings.email,
        settings.phoneDisplay,
        ...socialKeywords(),
      ),
      published: true,
    });
  });
}

function buildHomepageDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return (["en", "ar"] as const).map((language) => {
    const localeHero = getLocaleSection(bundle.locales, language, "hero") as Record<string, string>;
    const remote = bundle.homepage;
    const title =
      pickLocalized(remote?.heroTitle, language) || localeHero?.title || "Lunayair Marina";
    return baseDoc({
      id: buildKnowledgeDocId("homepage", "main", language),
      type: "homepage",
      language,
      title,
      content: joinSections([
        localeHero?.eyebrow || pickLocalized(remote?.heroEyebrow, language)
          ? `Region: ${localeHero?.eyebrow || pickLocalized(remote?.heroEyebrow, language)}`
          : "",
        `Headline: ${title}`,
        localeHero?.subtitle || pickLocalized(remote?.heroDescription, language)
          ? `Description: ${localeHero?.subtitle || pickLocalized(remote?.heroDescription, language)}`
          : "",
      ]),
      url: "/",
      source: remote ? "firestore" : "locale",
      sourcePath: remote ? "homepage/main" : `locales/${language}.json#hero`,
      keywords: extractKeywords(title, "homepage", "hero"),
      published: true,
    });
  });
}

function buildAboutDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return (["en", "ar"] as const).map((language) => {
    const localeAbout = getLocaleSection(bundle.locales, language, "about") as Record<
      string,
      unknown
    >;
    const remote = bundle.about;
    const values =
      remote?.values?.map(
        (item) =>
          `${pickLocalized(item.title, language)}: ${pickLocalized(item.description, language)}`,
      ) ?? [];

    return baseDoc({
      id: buildKnowledgeDocId("about", "main", language),
      type: "about",
      language,
      title:
        pickLocalized(remote?.title, language) ||
        (typeof localeAbout?.title === "string" ? localeAbout.title : "About Us"),
      content: joinSections([
        typeof localeAbout?.lead === "string"
          ? localeAbout.lead
          : pickLocalized(remote?.lead, language),
        typeof localeAbout?.body === "string"
          ? localeAbout.body
          : pickLocalized(remote?.body, language),
        remote?.mission || localeAbout?.mission
          ? `Mission: ${pickLocalized(remote?.mission, language) || String(localeAbout?.mission)}`
          : "",
        remote?.vision || localeAbout?.vision
          ? `Vision: ${pickLocalized(remote?.vision, language) || String(localeAbout?.vision)}`
          : "",
        values.length ? `Values:\n${bulletLines(values)}` : "",
      ]),
      url: "/about",
      source: remote ? "firestore" : "locale",
      sourcePath: remote ? "about/main" : `locales/${language}.json#about`,
      keywords: extractKeywords("about", "mission", "vision"),
      published: true,
    });
  });
}

function serviceCapabilityKeywords(slug: string): string[] {
  switch (slug) {
    case "yacht-management-360":
      return [
        "yacht-management-360",
        "full management",
        "operations",
        "maintenance",
        "تشغيل",
        "صيانة",
        "اداره كامله",
        "يشيل عني",
        "hands-off",
      ];
    case "crew-management":
      return ["crew-management", "crew", "طاقم", "توظيف", "متابعة الطاقم"];
    case "visiting-yacht-agency":
      return ["visiting-yacht-agency", "visiting", "agency", "يخت زائر", "وكالة", "قادمة"];
    case "marina-management":
      return ["marina-management", "marina", "مارينا", "تشغيل المارينا"];
    default:
      return [slug, "service", "yacht"];
  }
}

function buildServiceDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];
  for (const slug of SERVICE_SLUGS) {
    const service = bundle.services.find((item) => item.slug === slug);
    if (!service) continue;
    for (const language of ["en", "ar"] as const) {
      docs.push(
        baseDoc({
          id: buildKnowledgeDocId("service", slug, language),
          type: "service",
          language,
          title:
            pickLocalized(service.title, language) ||
            localeServiceCard(bundle, language, slug)?.title ||
            slug,
          content: buildServiceContent(
            language,
            slug,
            service,
            localeServiceCard(bundle, language, slug),
            localeServiceDetails(bundle, language, slug),
          ),
          slug,
          url: `/services/${slug}`,
          source: "locale",
          sourcePath: `services.details.${slug}`,
          keywords: extractKeywords(...serviceCapabilityKeywords(slug)),
          published: true,
        }),
      );
    }
  }
  return docs;
}

function buildFaqDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];
  const count = Math.max(bundle.faq.length, 4);
  for (let index = 0; index < count; index += 1) {
    for (const language of ["en", "ar"] as const) {
      const remote = bundle.faq[index];
      const localeItem = localeFaqItem(bundle, language, index);
      const question =
        localeItem?.question || (remote ? pickLocalized(remote.question, language) : "");
      const answer = localeItem?.answer || (remote ? pickLocalized(remote.answer, language) : "");
      if (!question || !answer) continue;
      docs.push(
        baseDoc({
          id: buildKnowledgeDocId("faq", `f${index + 1}`, language),
          type: "faq",
          language,
          title: question,
          content: joinSections([`Question: ${question}`, `Answer: ${answer}`]),
          url: "/services",
          source: remote ? "firestore" : "locale",
          sourcePath: remote ? `faq/${remote.id}` : `locales/${language}.json#faq`,
          keywords: extractKeywords(question, "faq"),
          published: true,
        }),
      );
    }
  }
  return docs;
}

function buildWhyDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return (["en", "ar"] as const).map((language) => {
    const localeWhy = getLocaleSection(bundle.locales, language, "why") as {
      title?: string;
      items?: Array<{ title: string; description: string }>;
    };
    const items =
      bundle.why?.items?.map(
        (item) =>
          `${pickLocalized(item.title, language)}: ${pickLocalized(item.description, language)}`,
      ) ??
      localeWhy?.items?.map((item) => `${item.title}: ${item.description}`) ??
      [];

    return baseDoc({
      id: buildKnowledgeDocId("why", "main", language),
      type: "why",
      language,
      title: pickLocalized(bundle.why?.title, language) || localeWhy?.title || "Why Choose Us",
      content: items.length ? `Reasons:\n${bulletLines(items)}` : "",
      url: "/services",
      source: bundle.why ? "firestore" : "locale",
      sourcePath: bundle.why ? "why/main" : `locales/${language}.json#why`,
      keywords: extractKeywords("why choose us", ...items),
      published: true,
    });
  });
}

function buildFleetDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  if (!bundle.fleet.length) return [];
  return (["en", "ar"] as const).map((language) =>
    baseDoc({
      id: buildKnowledgeDocId("fleet", "portfolio", language),
      type: "fleet",
      language,
      title: language === "ar" ? "اليخوت ضمن الإدارة" : "Yachts Under Management",
      content: joinSections([
        language === "ar"
          ? "ملاحظة: هذه أمثلة من محفظة اليخوت. لا تمثل توفراً فورياً للحجز أو الرسو."
          : "Note: Portfolio/example yachts only. They do NOT represent real-time booking or berth availability.",
        bulletLines(
          bundle.fleet.map((item) =>
            joinSections([
              `${item.yachtName} (${item.yachtLength})`,
              pickLocalized(item.yachtType, language),
              pickLocalized(item.description, language),
            ]),
          ),
          "",
        ),
      ]),
      url: "/",
      source: "cms",
      sourcePath: "fleet/*",
      keywords: extractKeywords(
        "fleet",
        "yacht",
        "أسطول",
        "محفظة",
        "يخت",
        ...bundle.fleet.map((item) => item.yachtName),
      ),
      published: true,
    }),
  );
}

function buildTeamDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return bundle.team
    .filter((member) => {
      const bio = `${pickLocalized(member.bio, "en")} ${pickLocalized(member.bio, "ar")}`;
      return bio.trim().length > 0 && !isPlaceholderTeamBio(bio);
    })
    .flatMap((member) =>
      (["en", "ar"] as const).map((language) =>
        baseDoc({
          id: buildKnowledgeDocId("team", member.id, language),
          type: "team",
          language,
          title: pickLocalized(member.name, language),
          content: joinSections([
            `${pickLocalized(member.name, language)} — ${pickLocalized(member.position, language)}`,
            pickLocalized(member.bio, language),
          ]),
          url: "/about",
          source: "firestore",
          sourcePath: `team/${member.id}`,
          keywords: extractKeywords(pickLocalized(member.name, language), "team", "فريق"),
          published: true,
        }),
      ),
    );
}

function buildTestimonialDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return bundle.testimonials.flatMap((item, index) => {
    const fromLocale = String(item.id || "").startsWith("locale-");
    return (["en", "ar"] as const).map((language) =>
      baseDoc({
        id: buildKnowledgeDocId("testimonial", item.id || `t${index + 1}`, language),
        type: "testimonial",
        language,
        title:
          typeof item.clientName === "string"
            ? item.clientName
            : pickLocalized(item.clientName, language),
        content: joinSections([
          typeof item.role === "string" ? item.role : pickLocalized(item.role, language),
          pickLocalized(item.text, language),
          "Note: Marketing testimonial; not a verified operational guarantee.",
        ]),
        url: "/",
        source: fromLocale ? "locale" : "firestore",
        sourcePath: fromLocale
          ? `locales/${language}.json#testimonials`
          : `testimonials/${item.id}`,
        keywords: extractKeywords(
          "testimonial",
          "review",
          "client",
          "رأي",
          "تجربة",
          "عملاء",
          "شهادات العملاء",
        ),
        published: true,
      }),
    );
  });
}

function buildGalleryDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  if (!bundle.gallery.length) return [];
  return (["en", "ar"] as const).map((language) =>
    baseDoc({
      id: buildKnowledgeDocId("gallery", "captions", language),
      type: "gallery",
      language,
      title: language === "ar" ? "معرض الصور (تعليقات)" : "Gallery captions",
      content: joinSections([
        language === "ar"
          ? "تعليقات نصية عامة لصور المعرض المنشورة على الموقع (ليست وصفاً تفصيلياً مخترعاً للصور):"
          : "Published textual captions for gallery images on the website (caption metadata only):",
        bulletLines(
          bundle.gallery.map((item) => pickLocalized(item.caption, language)),
          "",
        ),
      ]),
      url: "/",
      source: "static",
      sourcePath: "gallery/*#captions",
      keywords: extractKeywords("gallery", "معرض", "صور", "caption"),
      published: true,
    }),
  );
}

function buildBlogDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return bundle.blog.flatMap((post) =>
    (["en", "ar"] as const).map((language) =>
      baseDoc({
        id: buildKnowledgeDocId("blog", post.slug, language),
        type: "blog",
        language,
        title: pickLocalized(post.title, language),
        content: flattenBlogPost(post, language),
        slug: post.slug,
        url: `/blog/${post.slug}`,
        source: "static",
        sourcePath: `blog/${post.slug}`,
        keywords: extractKeywords(pickLocalized(post.title, language), "blog"),
        published: true,
      }),
    ),
  );
}

function buildLocationDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  if (bundle.locations.length) {
    return bundle.locations.flatMap((location) =>
      (["en", "ar"] as const).map((language) =>
        baseDoc({
          id: buildKnowledgeDocId("location", location.id, language),
          type: "location",
          language,
          title: pickLocalized(location.city, language),
          content: pickLocalized(location.description, language),
          source: "firestore",
          sourcePath: `locations/${location.id}`,
          keywords: extractKeywords(pickLocalized(location.city, language), "location"),
          published: true,
        }),
      ),
    );
  }

  // Fallback from published company settings (verified address / service area).
  const addressEn = pickLocalized(bundle.settings.address, "en");
  const addressAr = pickLocalized(bundle.settings.address, "ar");
  if (!addressEn && !addressAr) return [];

  return (["en", "ar"] as const).map((language) =>
    baseDoc({
      id: buildKnowledgeDocId("location", "primary", language),
      type: "location",
      language,
      title: language === "ar" ? "الموقع ومناطق الخدمة" : "Location & service areas",
      content: joinSections([
        `Address: ${pickLocalized(bundle.settings.address, language)}`,
        language === "ar"
          ? "مناطق الخدمة: جدة، البحر الأحمر، المملكة العربية السعودية، ومنطقة الخليج."
          : "Service area: Jeddah, Red Sea, Saudi Arabia, Gulf region.",
      ]),
      url: "/contact",
      source: "firestore",
      sourcePath: "settings/general#address",
      keywords: extractKeywords("jeddah", "جدة", "location", "red sea", "saudi"),
      published: true,
    }),
  );
}

function buildAdvertisingDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];
  for (const language of ["en", "ar"] as const) {
    const localeAds = getLocaleSection(bundle.locales, language, "advertising") as Record<
      string,
      unknown
    >;
    docs.push(
      baseDoc({
        id: buildKnowledgeDocId("advertisement", "overview", language),
        type: "advertisement",
        language,
        title: (typeof localeAds?.title === "string" ? localeAds.title : "") || "Advertising",
        content: joinSections([
          flattenUnknown(localeAds, language),
          "See /advertising for live campaigns.",
        ]),
        url: "/advertising",
        source: "locale",
        sourcePath: `locales/${language}.json#advertising`,
        keywords: extractKeywords(
          "advertising",
          "partners",
          "partnership",
          "إعلان",
          "إعلانات",
          "شراكة",
          "شراكات",
          "شركات",
        ),
        published: true,
      }),
    );
  }
  for (const ad of bundle.advertisements) {
    for (const language of ["en", "ar"] as const) {
      docs.push(
        baseDoc({
          id: buildKnowledgeDocId("advertisement", ad.id, language),
          type: "advertisement",
          language,
          title: pickLocalized(ad.companyName, language),
          content: joinSections([
            pickLocalized(ad.description, language),
            ad.package ? `Package: ${ad.package}` : "",
            ad.websiteUrl ? `Website: ${ad.websiteUrl}` : "",
          ]),
          url: "/advertising",
          source: "firestore",
          sourcePath: `advertisements/${ad.id}`,
          keywords: extractKeywords(
            "advertising",
            "partner",
            "إعلان",
            "شراكة",
            ad.package,
            pickLocalized(ad.companyName, language),
          ),
          published: true,
        }),
      );
    }
  }
  return docs;
}

function buildApplicationDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return (["en", "ar"] as const).map((language) => {
    const localeApp = getLocaleSection(bundle.locales, language, "application") as Record<
      string,
      unknown
    >;
    return baseDoc({
      id: buildKnowledgeDocId("application", "main", language),
      type: "application",
      language,
      title: (typeof localeApp?.title === "string" ? localeApp.title : "") || "Lunayair App",
      content: joinSections([
        flattenUnknown(localeApp, language),
        "Note: Mobile app is presented as coming-soon/marketing on the website.",
      ]),
      url: "/application",
      source: "locale",
      sourcePath: `locales/${language}.json#application`,
      keywords: extractKeywords("application", "app"),
      published: true,
    });
  });
}

function buildContactDocs(bundle: KnowledgeSourceBundle): KnowledgeDocument[] {
  return (["en", "ar"] as const).map((language) => {
    const localeContact = getLocaleSection(bundle.locales, language, "contact") as Record<
      string,
      unknown
    >;
    const settings = bundle.settings;
    const social = formatSocialLinks(settings.socialLinks, language);
    return baseDoc({
      id: buildKnowledgeDocId("contact", "main", language),
      type: "contact",
      language,
      title: (typeof localeContact?.title === "string" ? localeContact.title : "") || "Contact",
      content: joinSections([
        flattenUnknown(localeContact, language),
        `Phone: ${settings.phoneDisplay}`,
        `Email: ${settings.email}`,
        `Address: ${pickLocalized(settings.address, language)}`,
        `WhatsApp: ${settings.phoneDisplay}`,
        social ? `Social media:\n${social}` : "",
        "Contact page: /contact",
      ]),
      url: "/contact",
      source: "locale",
      sourcePath: `locales/${language}.json#contact`,
      keywords: extractKeywords(
        "contact",
        "phone",
        "jeddah",
        "whatsapp",
        "email",
        ...socialKeywords(),
      ),
      published: true,
    });
  });
}

export function buildKnowledgeDocuments(bundle: KnowledgeSourceBundle): {
  documents: KnowledgeDocument[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const trustVerified = bundle.trust?.slots?.some((slot) => {
    const en = pickLocalized(slot.body, "en");
    const ar = pickLocalized(slot.body, "ar");
    return !isPlaceholderTrustCopy(en) && !isPlaceholderTrustCopy(ar);
  });
  if (!trustVerified) skipped.push("trust placeholders (unverified certifications/licenses)");

  if (!bundle.team.length) {
    skipped.push("team (no published non-placeholder bios)");
  }

  const documents = [
    ...buildCompanyDocs(bundle),
    ...buildHomepageDocs(bundle),
    ...buildAboutDocs(bundle),
    ...buildServiceDocs(bundle),
    ...buildFaqDocs(bundle),
    ...buildWhyDocs(bundle),
    ...buildFleetDocs(bundle),
    ...buildTeamDocs(bundle),
    ...buildTestimonialDocs(bundle),
    ...buildGalleryDocs(bundle),
    ...buildBlogDocs(bundle),
    ...buildLocationDocs(bundle),
    ...buildAdvertisingDocs(bundle),
    ...buildApplicationDocs(bundle),
    ...buildContactDocs(bundle),
  ].filter((doc) => doc.content.trim().length > 0);

  return { documents, skipped };
}

export function summarizeIngestion(
  documents: KnowledgeDocument[],
  skipped: string[],
): IngestionReport {
  const byType: Record<string, number> = {};
  for (const doc of documents) byType[doc.type] = (byType[doc.type] ?? 0) + 1;
  const hasType = (type: string) => documents.some((doc) => doc.type === type);
  return {
    arabicDocuments: documents.filter((doc) => doc.language === "ar").length,
    englishDocuments: documents.filter((doc) => doc.language === "en").length,
    totalDocuments: documents.length,
    byType,
    skipped,
    coverage: {
      company: hasType("company"),
      homepage: hasType("homepage"),
      about: hasType("about"),
      services: hasType("service"),
      faq: hasType("faq"),
      why: hasType("why"),
      trust: hasType("trust"),
      fleet: hasType("fleet"),
      team: hasType("team"),
      testimonials: hasType("testimonial"),
      gallery: hasType("gallery"),
      blog: hasType("blog"),
      locations: hasType("location"),
      advertising: hasType("advertisement"),
      application: hasType("application"),
      contact: hasType("contact"),
    },
  };
}
