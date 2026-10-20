import { useEffect, useMemo, useState } from "react";
import { getCopyPath, loadCmsStore, setCopyPath, deepMergeCopy } from "@/lib/cms-store";
import {
  describeSaveResult,
  saveAbout,
  saveCopyBundle,
  saveHomepage,
  type SaveResult,
} from "@/services/adminCmsService";
import { useLanguage } from "@/lib/i18n";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";
import { cn } from "@/lib/utils";
import { ModalField } from "@/components/admin/Modal";
import { MediaUploader } from "@/components/admin/MediaUploader";
import type { AboutContent, HomepageContent } from "@/types/content";
import heroImage from "@/assets/hero/hero-main.webp";
import aboutImage from "@/assets/about/yacht_side_transom_landscape.png";

type Field = { path: string; label: string; textarea?: boolean };
type Section = { id: string; labelKey: string; fields: Field[] };

const SECTIONS: Section[] = [
  {
    id: "brand",
    labelKey: "admin.pages.sections.brand",
    fields: [
      { path: "brand.name", label: "Brand name" },
      { path: "brand.tagline", label: "Tagline" },
    ],
  },
  {
    id: "nav",
    labelKey: "admin.pages.sections.nav",
    fields: [
      { path: "nav.home", label: "Home" },
      { path: "nav.about", label: "About" },
      { path: "nav.services", label: "Services" },
      { path: "nav.blog", label: "Blog" },
      { path: "nav.application", label: "Application" },
      { path: "nav.gallery", label: "Gallery" },
      { path: "nav.contact", label: "Contact" },
      { path: "nav.cta", label: "CTA" },
      { path: "nav.contactUs", label: "Contact Us" },
    ],
  },
  {
    id: "hero",
    labelKey: "admin.pages.sections.hero",
    fields: [
      { path: "hero.eyebrow", label: "Eyebrow" },
      { path: "hero.title", label: "Title", textarea: true },
      { path: "hero.subtitle", label: "Subtitle", textarea: true },
      { path: "hero.primary", label: "Primary CTA" },
      { path: "hero.secondary", label: "Secondary CTA" },
      { path: "hero.scroll", label: "Scroll label" },
    ],
  },
  {
    id: "about",
    labelKey: "admin.pages.sections.about",
    fields: [
      { path: "about.eyebrow", label: "Eyebrow" },
      { path: "about.title", label: "Title", textarea: true },
      { path: "about.lead", label: "Lead", textarea: true },
      { path: "about.body", label: "Body", textarea: true },
      { path: "about.cta", label: "CTA" },
      { path: "about.pageTitle", label: "About page title", textarea: true },
      { path: "about.pageSubtitle", label: "About page subtitle", textarea: true },
      { path: "about.story.eyebrow", label: "Story eyebrow" },
      { path: "about.story.title", label: "Story title", textarea: true },
      { path: "about.story.body", label: "Story body", textarea: true },
      { path: "about.mission.eyebrow", label: "Mission eyebrow" },
      { path: "about.mission.body", label: "Mission body", textarea: true },
      { path: "about.vision.eyebrow", label: "Vision eyebrow" },
      { path: "about.vision.body", label: "Vision body", textarea: true },
      { path: "about.valuesTitle", label: "Values title", textarea: true },
      { path: "about.valuesLead", label: "Values lead", textarea: true },
      { path: "about.clients.eyebrow", label: "Clients eyebrow" },
      { path: "about.clients.title", label: "Clients title", textarea: true },
      { path: "about.clients.body", label: "Clients body", textarea: true },
      { path: "about.clients.quote", label: "Clients quote", textarea: true },
      { path: "about.ctaBand.eyebrow", label: "CTA band eyebrow" },
      { path: "about.ctaBand.title", label: "CTA band title", textarea: true },
      { path: "about.ctaBand.body", label: "CTA band body", textarea: true },
      { path: "about.ctaBand.button", label: "CTA band button" },
    ],
  },
  {
    id: "services",
    labelKey: "admin.pages.sections.services",
    fields: [
      { path: "services.eyebrow", label: "Eyebrow" },
      { path: "services.title", label: "Title", textarea: true },
      { path: "services.subtitle", label: "Subtitle", textarea: true },
      { path: "services.viewAll", label: "View all" },
      { path: "services.cta", label: "CTA" },
    ],
  },
  {
    id: "why",
    labelKey: "admin.pages.sections.why",
    fields: [
      { path: "why.eyebrow", label: "Eyebrow" },
      { path: "why.title", label: "Title", textarea: true },
    ],
  },
  {
    id: "trust",
    labelKey: "admin.pages.sections.trust",
    fields: [
      { path: "trust.eyebrow", label: "Eyebrow" },
      { path: "trust.title", label: "Title", textarea: true },
      { path: "trust.lead", label: "Lead", textarea: true },
      { path: "trust.cta", label: "CTA" },
    ],
  },
  {
    id: "gallery",
    labelKey: "admin.pages.sections.gallery",
    fields: [
      { path: "gallery.eyebrow", label: "Eyebrow" },
      { path: "gallery.title", label: "Title", textarea: true },
      { path: "gallery.subtitle", label: "Subtitle", textarea: true },
      { path: "gallery.viewAll", label: "View all" },
    ],
  },
  {
    id: "fleet",
    labelKey: "admin.pages.sections.fleet",
    fields: [
      { path: "fleet.eyebrow", label: "Eyebrow" },
      { path: "fleet.title", label: "Title", textarea: true },
      { path: "fleet.subtitle", label: "Subtitle", textarea: true },
      { path: "fleet.viewAll", label: "View all" },
    ],
  },
  {
    id: "testimonials",
    labelKey: "admin.pages.sections.testimonials",
    fields: [
      { path: "testimonials.eyebrow", label: "Eyebrow" },
      { path: "testimonials.title", label: "Title", textarea: true },
      { path: "testimonials.subtitle", label: "Subtitle", textarea: true },
    ],
  },
  {
    id: "faq",
    labelKey: "admin.pages.sections.faq",
    fields: [
      { path: "faq.eyebrow", label: "Eyebrow" },
      { path: "faq.title", label: "Title", textarea: true },
      { path: "faq.subtitle", label: "Subtitle", textarea: true },
    ],
  },
  {
    id: "blog",
    labelKey: "admin.pages.sections.blog",
    fields: [
      { path: "blog.eyebrow", label: "Eyebrow" },
      { path: "blog.title", label: "Title", textarea: true },
      { path: "blog.subtitle", label: "Subtitle", textarea: true },
      { path: "blog.viewAll", label: "View all" },
      { path: "blog.readMore", label: "Read more" },
      { path: "blog.empty", label: "Empty state" },
    ],
  },
  {
    id: "contact",
    labelKey: "admin.pages.sections.contact",
    fields: [
      { path: "contact.eyebrow", label: "Eyebrow" },
      { path: "contact.title", label: "Title", textarea: true },
      { path: "contact.subtitle", label: "Subtitle", textarea: true },
      { path: "contact.info.title", label: "Info title" },
      { path: "contact.info.subtitle", label: "Info subtitle", textarea: true },
      { path: "contact.formSection.title", label: "Form title", textarea: true },
      { path: "contact.pathways.title", label: "Pathways title", textarea: true },
      { path: "contact.pathways.visit.title", label: "Pathway visit title" },
      { path: "contact.pathways.visit.body", label: "Pathway visit body", textarea: true },
      { path: "contact.pathways.visit.cta", label: "Pathway visit CTA" },
      { path: "contact.pathways.emergency.title", label: "Pathway emergency title" },
      { path: "contact.pathways.emergency.body", label: "Pathway emergency body", textarea: true },
      { path: "contact.pathways.emergency.cta", label: "Pathway emergency CTA" },
      { path: "contact.pathways.charter.title", label: "Pathway charter title" },
      { path: "contact.pathways.charter.body", label: "Pathway charter body", textarea: true },
      { path: "contact.pathways.charter.cta", label: "Pathway charter CTA" },
      { path: "contact.lounge.eyebrow", label: "Lounge eyebrow" },
      { path: "contact.lounge.title", label: "Lounge title", textarea: true },
      { path: "contact.lounge.body", label: "Lounge body", textarea: true },
    ],
  },
  {
    id: "whatsapp",
    labelKey: "admin.pages.sections.whatsapp",
    fields: [
      { path: "whatsapp.label", label: "Label" },
      { path: "whatsapp.prefill", label: "Prefill message", textarea: true },
    ],
  },
  {
    id: "application",
    labelKey: "admin.pages.sections.application",
    fields: [
      { path: "application.hero.eyebrow", label: "Hero eyebrow" },
      { path: "application.hero.title", label: "Hero title", textarea: true },
      { path: "application.hero.description", label: "Hero description", textarea: true },
      { path: "application.hero.ask", label: "Ask CTA" },
      { path: "application.hero.appStore", label: "App Store label" },
      { path: "application.hero.googlePlay", label: "Google Play label" },
      { path: "application.overview.eyebrow", label: "Overview eyebrow" },
      { path: "application.overview.title", label: "Overview title", textarea: true },
      { path: "application.tanks.eyebrow", label: "Fleet eyebrow" },
      { path: "application.tanks.title", label: "Fleet title", textarea: true },
      { path: "application.tanks.description", label: "Fleet description", textarea: true },
      { path: "application.checklist.eyebrow", label: "Schedule eyebrow" },
      { path: "application.checklist.title", label: "Schedule title", textarea: true },
      { path: "application.checklist.description", label: "Schedule description", textarea: true },
      { path: "application.services.eyebrow", label: "Bookings eyebrow" },
      { path: "application.services.title", label: "Bookings title", textarea: true },
      { path: "application.services.description", label: "Bookings description", textarea: true },
    ],
  },
  {
    id: "footer",
    labelKey: "admin.pages.sections.footer",
    fields: [
      { path: "footer.description", label: "Description", textarea: true },
      { path: "footer.services", label: "Services heading" },
      { path: "footer.links", label: "Links heading" },
      { path: "footer.contact", label: "Contact heading" },
      { path: "footer.rights", label: "Rights" },
      { path: "footer.admin", label: "Admin link label" },
    ],
  },
];

function readString(dict: Record<string, unknown>, path: string): string {
  const value = getCopyPath(dict, path);
  return typeof value === "string" ? value : "";
}

function defaultHomepage(): HomepageContent {
  return {
    heroTitle: { en: enLocale.hero.title, ar: arLocale.hero.title },
    heroDescription: { en: enLocale.hero.subtitle, ar: arLocale.hero.subtitle },
    heroEyebrow: { en: enLocale.hero.eyebrow, ar: arLocale.hero.eyebrow },
    heroVideo: "/videos/lunayair.mp4",
    heroImage,
    primaryCTA: { en: enLocale.hero.primary, ar: arLocale.hero.primary },
    secondaryCTA: { en: enLocale.hero.secondary, ar: arLocale.hero.secondary },
    scrollLabel: { en: enLocale.hero.scroll, ar: arLocale.hero.scroll },
  };
}

function defaultAbout(): AboutContent {
  return {
    title: { en: enLocale.about.title, ar: arLocale.about.title },
    description: { en: enLocale.about.lead, ar: arLocale.about.lead },
    lead: { en: enLocale.about.lead, ar: arLocale.about.lead },
    body: { en: enLocale.about.body, ar: arLocale.about.body },
    eyebrow: { en: enLocale.about.eyebrow, ar: arLocale.about.eyebrow },
    mission: { en: enLocale.about.mission.body, ar: arLocale.about.mission.body },
    vision: { en: enLocale.about.vision.body, ar: arLocale.about.vision.body },
    values: [],
    image: aboutImage,
    points: [],
    stats: [
      { value: 42, suffix: "", label: { en: "Yachts", ar: "يخوت" } },
      { value: 78, suffix: "", label: { en: "Partners", ar: "شركاء" } },
      { value: 13, suffix: "", label: { en: "Minutes", ar: "دقائق" } },
    ],
  };
}

function sanitizeLocalized(
  value: { en: string; ar: string } | undefined,
  fallback: { en: string; ar: string },
): { en: string; ar: string } {
  if (!value) return fallback;
  const looksLikeKey = (text: string) =>
    !text.trim() || /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(text.trim());
  return {
    en: looksLikeKey(value.en) ? fallback.en : value.en,
    ar: looksLikeKey(value.ar) ? fallback.ar : value.ar,
  };
}

function sanitizeHomepage(homepage: HomepageContent | null | undefined): HomepageContent {
  const defaults = defaultHomepage();
  if (!homepage) return defaults;
  return {
    ...homepage,
    heroTitle: sanitizeLocalized(homepage.heroTitle, defaults.heroTitle),
    heroDescription: sanitizeLocalized(homepage.heroDescription, defaults.heroDescription),
    heroEyebrow: sanitizeLocalized(homepage.heroEyebrow, defaults.heroEyebrow),
    primaryCTA: sanitizeLocalized(homepage.primaryCTA, defaults.primaryCTA),
    secondaryCTA: sanitizeLocalized(homepage.secondaryCTA, defaults.secondaryCTA),
    scrollLabel: sanitizeLocalized(homepage.scrollLabel, defaults.scrollLabel),
    heroVideo: homepage.heroVideo || defaults.heroVideo,
    heroImage: homepage.heroImage || defaults.heroImage,
  };
}

function sanitizeAbout(about: AboutContent | null | undefined): AboutContent {
  const defaults = defaultAbout();
  if (!about) return defaults;
  return {
    ...about,
    title: sanitizeLocalized(about.title, defaults.title),
    description: sanitizeLocalized(about.description, defaults.description),
    lead: sanitizeLocalized(about.lead, defaults.lead),
    body: sanitizeLocalized(about.body, defaults.body),
    eyebrow: sanitizeLocalized(about.eyebrow, defaults.eyebrow),
    mission: sanitizeLocalized(about.mission, defaults.mission),
    vision: sanitizeLocalized(about.vision, defaults.vision),
    image: about.image || defaults.image,
    points: about.points?.length ? about.points : defaults.points,
    stats: about.stats?.length ? about.stats : defaults.stats,
    values: about.values ?? [],
  };
}

export function PageCopyEditor() {
  const { t, language } = useLanguage();
  const cmsDefaults = useMemo(() => {
    const cms = loadCmsStore();
    return {
      copy: {
        en: deepMergeCopy(enLocale as Record<string, unknown>, cms.copy?.en ?? null),
        ar: deepMergeCopy(arLocale as Record<string, unknown>, cms.copy?.ar ?? null),
      },
      homepage: sanitizeHomepage(cms.homepage),
      about: sanitizeAbout(cms.about),
    };
  }, []);

  const [copy, setCopy] = useState(cmsDefaults.copy);
  const [homepage, setHomepage] = useState(cmsDefaults.homepage);
  const [about, setAbout] = useState(cmsDefaults.about);
  const [sectionId, setSectionId] = useState(SECTIONS[0]!.id);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setCopy(cmsDefaults.copy);
    setHomepage(cmsDefaults.homepage);
    setAbout(cmsDefaults.about);
  }, [cmsDefaults]);

  const section = SECTIONS.find((item) => item.id === sectionId) ?? SECTIONS[0]!;
  const visibleSections = SECTIONS.filter((item) => {
    if (!filter.trim()) return true;
    const label = t(item.labelKey).toLowerCase();
    return (
      label.includes(filter.trim().toLowerCase()) || item.id.includes(filter.trim().toLowerCase())
    );
  });

  const setField = (lang: "en" | "ar", path: string, value: string) => {
    setCopy((current) => setCopyPath(current, lang, path, value));
  };

  const save = async () => {
    setSaving(true);
    const results: SaveResult[] = await Promise.all([
      saveCopyBundle(copy),
      saveHomepage(homepage),
      saveAbout(about),
    ]);
    const synced = results.every((item) => item.ok && item.sync === "synced");
    setStatus(
      synced
        ? t("admin.cms.savedSynced")
        : describeSaveResult(results[0]!, {
            synced: t("admin.cms.savedSynced"),
            failed: t("admin.cms.savedFailed"),
          }),
    );
    setSaving(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-6">
      <aside className="rounded-2xl border border-navy/8 bg-white p-3 shadow-sm">
        <p className="px-2 py-2 text-[0.6rem] tracking-[0.22em] text-navy/45 uppercase">
          {t("admin.pages.sectionsLabel")}
        </p>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("admin.search")}
          className="mb-2 w-full rounded-lg border border-navy/10 bg-sand px-3 py-2.5 text-xs outline-none focus:border-navy/30"
        />
        <ul className="admin-hide-scrollbar flex max-h-none gap-2 overflow-x-auto pb-1 lg:max-h-[70vh] lg:flex-col lg:space-y-1 lg:gap-0 lg:overflow-y-auto lg:pb-0">
          {visibleSections.map((item) => (
            <li key={item.id} className="shrink-0 lg:shrink lg:w-full">
              <button
                type="button"
                onClick={() => setSectionId(item.id)}
                className={cn(
                  "min-h-10 w-full whitespace-nowrap rounded-xl px-3 py-2.5 text-start text-sm transition-colors",
                  sectionId === item.id
                    ? "bg-navy text-white"
                    : "bg-sand text-navy/65 hover:text-navy lg:bg-transparent",
                )}
              >
                {t(item.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 rounded-2xl border border-navy/8 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-display text-xl text-navy sm:text-2xl">{t(section.labelKey)}</h3>
            <p className="mt-1 text-sm text-navy/55">{t("admin.pages.hint")}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            {status ? <span className="text-xs text-navy/55">{status}</span> : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="min-h-11 w-full rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90 disabled:opacity-60 sm:w-auto"
            >
              {t("admin.content.save")}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {section.fields.map((field) => (
            <div key={field.path} className="grid gap-4 lg:grid-cols-2">
              {(["en", "ar"] as const).map((lang) => (
                <label key={lang} className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {field.label} · {lang.toUpperCase()}
                  </span>
                  {field.textarea ? (
                    <textarea
                      rows={3}
                      value={readString(copy[lang], field.path)}
                      onChange={(event) => setField(lang, field.path, event.target.value)}
                      className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none transition-colors focus:border-navy/30"
                      dir={lang === "ar" ? "rtl" : "ltr"}
                    />
                  ) : (
                    <input
                      value={readString(copy[lang], field.path)}
                      onChange={(event) => setField(lang, field.path, event.target.value)}
                      className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none transition-colors focus:border-navy/30"
                      dir={lang === "ar" ? "rtl" : "ltr"}
                    />
                  )}
                </label>
              ))}
            </div>
          ))}

          {sectionId === "hero" ? (
            <div className="space-y-5 border-t border-navy/8 pt-6">
              <p className="text-[0.6rem] tracking-[0.22em] text-navy/40 uppercase">
                {t("admin.content.media")}
              </p>
              <ModalField
                label="Hero video URL"
                value={homepage.heroVideo}
                onChange={(value) => setHomepage({ ...homepage, heroVideo: value })}
              />
              <MediaUploader
                label={t("admin.content.background")}
                value={homepage.heroImage}
                pathPrefix="images/hero"
                onChange={(url) => setHomepage({ ...homepage, heroImage: url })}
              />
            </div>
          ) : null}

          {sectionId === "about" ? (
            <div className="space-y-5 border-t border-navy/8 pt-6">
              <p className="text-[0.6rem] tracking-[0.22em] text-navy/40 uppercase">
                {t("admin.content.media")}
              </p>
              <MediaUploader
                label={t("admin.table.image")}
                value={about.image}
                pathPrefix="images/about"
                onChange={(url) => setAbout({ ...about, image: url })}
              />
              <p className="text-[0.6rem] tracking-[0.22em] text-navy/40 uppercase">
                {t("admin.content.statistics")}
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {about.stats.map((stat, index) => (
                  <div key={index} className="space-y-3">
                    <ModalField
                      label={`Value 0${index + 1}`}
                      value={String(stat.value)}
                      onChange={(value) => {
                        const stats = [...about.stats];
                        stats[index] = { ...stat, value: Number(value) || 0 };
                        setAbout({ ...about, stats });
                      }}
                    />
                    <ModalField
                      label={`Label 0${index + 1}`}
                      value={stat.label[language]}
                      onChange={(value) => {
                        const stats = [...about.stats];
                        stats[index] = {
                          ...stat,
                          label: { ...stat.label, [language]: value },
                        };
                        setAbout({ ...about, stats });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
