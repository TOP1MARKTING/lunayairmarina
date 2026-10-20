import { useMemo, useState } from "react";
import { getCopyPath, loadCmsStore, setCopyPath } from "@/lib/cms-store";
import { describeSaveResult, saveCopyBundle, saveServices } from "@/services/adminCmsService";
import { SERVICE_SLUGS } from "@/data/services";
import { useLanguage } from "@/lib/i18n";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";
import { cn } from "@/lib/utils";
import { MediaUploader } from "@/components/admin/MediaUploader";
import type { ServiceContent } from "@/types/content";

type DetailDraft = {
  title: string;
  intro: string;
  summary: string;
  detailTitle: string;
  detailBody: string;
  benefitsLead: string;
  benefits: string;
  valueTitle: string;
  valueLead: string;
  startCta: string;
  exploreCta: string;
};

const FIELDS: Array<{ key: keyof DetailDraft; label: string; textarea?: boolean }> = [
  { key: "title", label: "Page title" },
  { key: "intro", label: "Intro", textarea: true },
  { key: "summary", label: "Summary", textarea: true },
  { key: "detailTitle", label: "Detail title" },
  { key: "detailBody", label: "Detail body", textarea: true },
  { key: "benefitsLead", label: "Benefits lead", textarea: true },
  { key: "benefits", label: "Benefits (one per line)", textarea: true },
  { key: "valueTitle", label: "Value title" },
  { key: "valueLead", label: "Value lead", textarea: true },
  { key: "startCta", label: "Start CTA" },
  { key: "exploreCta", label: "Explore CTA" },
];

function readDetail(dict: Record<string, unknown>, slug: string): DetailDraft {
  const base = `services.details.${slug}`;
  const benefits = getCopyPath(dict, `${base}.benefits`);
  return {
    title: String(getCopyPath(dict, `${base}.title`) ?? ""),
    intro: String(getCopyPath(dict, `${base}.intro`) ?? ""),
    summary: String(getCopyPath(dict, `${base}.summary`) ?? ""),
    detailTitle: String(getCopyPath(dict, `${base}.detailTitle`) ?? ""),
    detailBody: String(getCopyPath(dict, `${base}.detailBody`) ?? ""),
    benefitsLead: String(getCopyPath(dict, `${base}.benefitsLead`) ?? ""),
    benefits: Array.isArray(benefits) ? benefits.map(String).join("\n") : "",
    valueTitle: String(getCopyPath(dict, `${base}.valueTitle`) ?? ""),
    valueLead: String(getCopyPath(dict, `${base}.valueLead`) ?? ""),
    startCta: String(getCopyPath(dict, `${base}.startCta`) ?? ""),
    exploreCta: String(getCopyPath(dict, `${base}.exploreCta`) ?? ""),
  };
}

function applyLangDraft(
  copy: { en: Record<string, unknown>; ar: Record<string, unknown> },
  lang: "en" | "ar",
  slug: string,
  draft: DetailDraft,
) {
  let next = copy;
  const base = `services.details.${slug}`;
  const pairs: Array<[string, unknown]> = [
    [`${base}.title`, draft.title],
    [`${base}.intro`, draft.intro],
    [`${base}.summary`, draft.summary],
    [`${base}.detailTitle`, draft.detailTitle],
    [`${base}.detailBody`, draft.detailBody],
    [`${base}.benefitsLead`, draft.benefitsLead],
    [
      `${base}.benefits`,
      draft.benefits
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ],
    [`${base}.valueTitle`, draft.valueTitle],
    [`${base}.valueLead`, draft.valueLead],
    [`${base}.startCta`, draft.startCta],
    [`${base}.exploreCta`, draft.exploreCta],
  ];
  for (const [path, value] of pairs) {
    next = setCopyPath(next, lang, path, value);
  }
  return next;
}

export function ServiceDetailEditor() {
  const { t } = useLanguage();
  const [slug, setSlug] = useState<string>(SERVICE_SLUGS[0]!);
  const baseCopy = useMemo(() => {
    const cms = loadCmsStore();
    return {
      en: { ...(enLocale as Record<string, unknown>), ...(cms.copy?.en ?? {}) },
      ar: { ...(arLocale as Record<string, unknown>), ...(cms.copy?.ar ?? {}) },
    };
  }, []);
  const [copy, setCopy] = useState(baseCopy);
  const [draftEn, setDraftEn] = useState(() => readDetail(baseCopy.en, slug));
  const [draftAr, setDraftAr] = useState(() => readDetail(baseCopy.ar, slug));
  const [cover, setCover] = useState(() => {
    return loadCmsStore().services.find((s) => s.slug === slug)?.image ?? "";
  });
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const switchSlug = (next: string) => {
    setSlug(next);
    setDraftEn(readDetail(copy.en, next));
    setDraftAr(readDetail(copy.ar, next));
    setCover(loadCmsStore().services.find((s) => s.slug === next)?.image ?? "");
  };

  const save = async () => {
    setSaving(true);
    let nextCopy = applyLangDraft(copy, "en", slug, draftEn);
    nextCopy = applyLangDraft(nextCopy, "ar", slug, draftAr);
    setCopy(nextCopy);
    const copyResult = await saveCopyBundle(nextCopy);

    if (cover) {
      const cms = loadCmsStore();
      let services: ServiceContent[] = cms.services.length
        ? cms.services.map((item) => (item.slug === slug ? { ...item, image: cover } : item))
        : [];
      if (!services.some((item) => item.slug === slug)) {
        services = [
          ...services,
          {
            id: slug,
            slug,
            title: {
              en: draftEn.title || draftAr.title,
              ar: draftAr.title || draftEn.title,
            },
            description: {
              en: draftEn.summary || draftAr.summary,
              ar: draftAr.summary || draftEn.summary,
            },
            image: cover,
            features: [],
            order: services.length + 1,
          },
        ];
      }
      await saveServices(services);
    }

    setStatus(
      describeSaveResult(copyResult, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
    setSaving(false);
  };

  const cmsSlugs = useMemo(() => {
    const fromCms = loadCmsStore()
      .services.map((item) => item.slug)
      .filter(Boolean);
    return Array.from(new Set([...SERVICE_SLUGS, ...fromCms]));
  }, [slug, status]);

  return (
    <div className="mt-8 rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-navy">{t("admin.services.detailEditor")}</h3>
          <p className="mt-1 text-sm text-navy/55">{t("admin.services.detailHint")}</p>
        </div>
        <div className="flex items-center gap-3">
          {status ? <span className="text-xs text-navy/55">{status}</span> : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase hover:bg-navy/90 disabled:opacity-60"
          >
            {t("admin.content.save")}
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {cmsSlugs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => switchSlug(item)}
            className={cn(
              "rounded-full px-3 py-1.5 text-[0.65rem] tracking-[0.14em] uppercase",
              slug === item ? "bg-navy text-white" : "border border-navy/15 text-navy/60",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mb-5">
        <MediaUploader
          label={t("admin.table.image")}
          value={cover}
          pathPrefix="images/services"
          onChange={setCover}
        />
      </div>

      {FIELDS.map((field) => (
        <div
          key={field.key}
          className={cn("mb-4 grid gap-4", field.textarea ? "lg:grid-cols-2" : "sm:grid-cols-2")}
        >
          {(["en", "ar"] as const).map((lang) => {
            const draft = lang === "en" ? draftEn : draftAr;
            const setDraft = lang === "en" ? setDraftEn : setDraftAr;
            return (
              <label key={lang} className="flex flex-col gap-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {field.label} · {lang.toUpperCase()}
                </span>
                {field.textarea ? (
                  <textarea
                    rows={3}
                    value={draft[field.key]}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                ) : (
                  <input
                    value={draft[field.key]}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                )}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
