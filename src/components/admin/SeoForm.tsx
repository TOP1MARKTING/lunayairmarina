import { useMemo, useState } from "react";
import type { PageHeaderId, SeoPageId, SeoPageMeta } from "@/lib/cms-store";
import { loadCmsStore } from "@/lib/cms-store";
import {
  DEFAULT_SEO,
  DEFAULT_SERVICE_SEO,
  getSeoFromCms,
  getServiceSeoFromCms,
  listServiceSeoTargets,
  scoreSeo,
} from "@/services/seoService";
import {
  describeSaveResult,
  saveAllPageHeaders,
  saveSeoPage,
  saveServiceSeo,
} from "@/services/adminCmsService";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PAGE_IDS: SeoPageId[] = [
  "home",
  "about",
  "services",
  "contact",
  "blog",
  "application",
  "advertising",
];
const HEADER_IDS: PageHeaderId[] = [
  "about",
  "services",
  "contact",
  "blog",
  "application",
  "advertising",
];

type Tab = "pages" | "services" | "headers";

function emptyLocalized() {
  return { en: "", ar: "" };
}

function seoCheckLabel(
  check: ReturnType<typeof scoreSeo>["checks"][number],
  t: (key: string) => string,
) {
  const template = t(`admin.seo.checks.${check.id}`);
  if (typeof check.current === "number") {
    return template.replace("{{n}}", String(check.current));
  }
  return template;
}

function ensureMeta(meta: SeoPageMeta): SeoPageMeta {
  return {
    title: meta.title ?? emptyLocalized(),
    description: meta.description ?? emptyLocalized(),
    keywords: meta.keywords ?? emptyLocalized(),
    focusKeyword: meta.focusKeyword ?? emptyLocalized(),
    ogImage: meta.ogImage ?? "",
    ogType: meta.ogType ?? "website",
    canonicalPath: meta.canonicalPath ?? "",
    robots: meta.robots ?? "index,follow",
  };
}

export function SeoForm() {
  const { t, language } = useLanguage();
  const serviceSlugs = listServiceSeoTargets();
  const [tab, setTab] = useState<Tab>("pages");
  const [pageId, setPageId] = useState<SeoPageId>("home");
  const [serviceSlug, setServiceSlug] = useState(serviceSlugs[0] ?? "yacht-management-360");
  const [pageDrafts, setPageDrafts] = useState<Record<SeoPageId, SeoPageMeta>>(() => {
    const initial = {} as Record<SeoPageId, SeoPageMeta>;
    for (const id of PAGE_IDS) initial[id] = ensureMeta(getSeoFromCms(id) ?? DEFAULT_SEO[id]);
    return initial;
  });
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, SeoPageMeta>>(() => {
    const initial: Record<string, SeoPageMeta> = {};
    for (const slug of serviceSlugs) {
      initial[slug] = ensureMeta(
        getServiceSeoFromCms(slug) ?? DEFAULT_SERVICE_SEO[slug as keyof typeof DEFAULT_SERVICE_SEO],
      );
    }
    return initial;
  });
  const [headers, setHeaders] = useState(() => ({ ...loadCmsStore().pageHeaders }));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = tab === "services" ? serviceDrafts[serviceSlug]! : pageDrafts[pageId]!;
  const score = useMemo(() => scoreSeo(draft, language), [draft, language]);

  const update = (patch: Partial<SeoPageMeta>) => {
    if (tab === "services") {
      setServiceDrafts((current) => ({
        ...current,
        [serviceSlug]: { ...current[serviceSlug]!, ...patch },
      }));
      return;
    }
    setPageDrafts((current) => ({
      ...current,
      [pageId]: { ...current[pageId]!, ...patch },
    }));
  };

  const save = async () => {
    setSaving(true);
    let result;
    if (tab === "headers") {
      result = await saveAllPageHeaders(headers);
    } else if (tab === "services") {
      result = await saveServiceSeo(serviceSlug, serviceDrafts[serviceSlug]!);
    } else {
      result = await saveSeoPage(pageId, pageDrafts[pageId]!);
    }
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["pages", t("admin.seo.tabs.pages")],
            ["services", t("admin.seo.tabs.services")],
            ["headers", t("admin.seo.tabs.headers")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full px-4 py-2 text-xs tracking-[0.16em] uppercase transition-colors",
              tab === id
                ? "bg-navy text-white"
                : "border border-navy/15 text-navy/65 hover:bg-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "headers" ? (
        <div className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl text-navy">{t("admin.seo.tabs.headers")}</h3>
              <p className="mt-1 text-sm text-navy/55">{t("admin.seo.headersHint")}</p>
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
          <div className="grid gap-6 md:grid-cols-2">
            {HEADER_IDS.map((id) => (
              <MediaUploader
                key={id}
                label={t(`admin.seo.pages.${id === "services" ? "services" : id}`)}
                value={headers[id] ?? ""}
                pathPrefix="images/headers"
                onChange={(url) => setHeaders((current) => ({ ...current, [id]: url }))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-2xl border border-navy/8 bg-white p-3 shadow-sm">
            <p className="px-2 py-2 text-[0.6rem] tracking-[0.22em] text-navy/45 uppercase">
              {tab === "services" ? t("admin.seo.servicesLabel") : t("admin.seo.pagesLabel")}
            </p>
            <ul className="space-y-1">
              {tab === "services"
                ? serviceSlugs.map((slug) => (
                    <li key={slug}>
                      <button
                        type="button"
                        onClick={() => setServiceSlug(slug)}
                        className={cn(
                          "w-full rounded-xl px-3 py-2.5 text-start text-sm transition-colors",
                          serviceSlug === slug
                            ? "bg-navy text-white"
                            : "text-navy/65 hover:bg-sand hover:text-navy",
                        )}
                      >
                        {slug}
                      </button>
                    </li>
                  ))
                : PAGE_IDS.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setPageId(id)}
                        className={cn(
                          "w-full rounded-xl px-3 py-2.5 text-start text-sm transition-colors",
                          pageId === id
                            ? "bg-navy text-white"
                            : "text-navy/65 hover:bg-sand hover:text-navy",
                        )}
                      >
                        {t(`admin.seo.pages.${id}`)}
                      </button>
                    </li>
                  ))}
            </ul>
          </aside>

          <div className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-2xl text-navy">
                  {tab === "services" ? serviceSlug : t(`admin.seo.pages.${pageId}`)}
                </h3>
                <p className="mt-1 text-sm text-navy/55">{t("admin.seo.hint")}</p>
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

            <div
              className={cn(
                "mb-6 rounded-xl border px-4 py-3",
                score.score >= 80
                  ? "border-emerald-300/50 bg-emerald-50"
                  : score.score >= 50
                    ? "border-amber-300/50 bg-amber-50"
                    : "border-red-300/40 bg-red-50",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-navy">{t("admin.seo.score")}</p>
                <p className="font-display text-2xl text-navy">{score.score}%</p>
              </div>
              <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                {score.checks.map((check) => (
                  <li
                    key={check.id}
                    className={cn("text-xs", check.ok ? "text-emerald-700" : "text-navy/55")}
                  >
                    {check.ok ? "✓" : "○"} {seoCheckLabel(check, t)}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {(["en", "ar"] as const).map((lang) => (
                <label key={`title-${lang}`} className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.seo.title")} · {lang.toUpperCase()} ({draft.title[lang].length})
                  </span>
                  <input
                    value={draft.title[lang]}
                    onChange={(event) =>
                      update({ title: { ...draft.title, [lang]: event.target.value } })
                    }
                    className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                </label>
              ))}
              {(["en", "ar"] as const).map((lang) => (
                <label key={`desc-${lang}`} className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.seo.description")} · {lang.toUpperCase()} (
                    {draft.description[lang].length})
                  </span>
                  <textarea
                    rows={4}
                    value={draft.description[lang]}
                    onChange={(event) =>
                      update({
                        description: { ...draft.description, [lang]: event.target.value },
                      })
                    }
                    className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                </label>
              ))}
              {(["en", "ar"] as const).map((lang) => (
                <label key={`kw-${lang}`} className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.seo.keywords")} · {lang.toUpperCase()}
                  </span>
                  <input
                    value={draft.keywords?.[lang] ?? ""}
                    onChange={(event) =>
                      update({
                        keywords: {
                          en: draft.keywords?.en ?? "",
                          ar: draft.keywords?.ar ?? "",
                          [lang]: event.target.value,
                        },
                      })
                    }
                    className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                </label>
              ))}
              {(["en", "ar"] as const).map((lang) => (
                <label key={`focus-${lang}`} className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.seo.focusKeyword")} · {lang.toUpperCase()}
                  </span>
                  <input
                    value={draft.focusKeyword?.[lang] ?? ""}
                    onChange={(event) =>
                      update({
                        focusKeyword: {
                          en: draft.focusKeyword?.en ?? "",
                          ar: draft.focusKeyword?.ar ?? "",
                          [lang]: event.target.value,
                        },
                      })
                    }
                    className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {t("admin.seo.canonical")}
                </span>
                <input
                  value={draft.canonicalPath ?? ""}
                  onChange={(event) => update({ canonicalPath: event.target.value })}
                  placeholder="/about"
                  className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                  dir="ltr"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {t("admin.seo.robots")}
                </span>
                <select
                  value={draft.robots ?? "index,follow"}
                  onChange={(event) => update({ robots: event.target.value })}
                  className="rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30"
                >
                  <option value="index,follow">index,follow</option>
                  <option value="noindex,follow">noindex,follow</option>
                  <option value="index,nofollow">index,nofollow</option>
                  <option value="noindex,nofollow">noindex,nofollow</option>
                </select>
              </label>
            </div>

            <div className="mt-6">
              <MediaUploader
                label={t("admin.seo.ogImage")}
                value={draft.ogImage ?? ""}
                pathPrefix="images/seo"
                onChange={(url) => update({ ogImage: url })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
