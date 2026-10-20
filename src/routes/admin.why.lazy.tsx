import { useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { asLocalized, pairLocalized } from "@/lib/localized";
import { loadCmsStore } from "@/lib/cms-store";
import { describeSaveResult, saveWhy } from "@/services/adminCmsService";
import type { WhyContent } from "@/types/content";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";

export const Route = createLazyFileRoute("/admin/why")({
  component: AdminWhyPage,
});

function seedWhy(): WhyContent {
  const cms = loadCmsStore();
  if (cms.why) {
    return {
      eyebrow: asLocalized(cms.why.eyebrow),
      title: asLocalized(cms.why.title),
      items: cms.why.items.map((item) => ({
        title: asLocalized(item.title),
        description: asLocalized(item.description),
      })),
    };
  }
  const enItems = (enLocale as { why: { items: Array<{ title: string; description: string }> } })
    .why.items;
  const arItems = (arLocale as { why: { items: Array<{ title: string; description: string }> } })
    .why.items;
  return {
    eyebrow: { en: enLocale.why.eyebrow, ar: arLocale.why.eyebrow },
    title: { en: enLocale.why.title, ar: arLocale.why.title },
    items: enItems.map((item, index) => ({
      title: { en: item.title, ar: arItems[index]?.title ?? item.title },
      description: { en: item.description, ar: arItems[index]?.description ?? item.description },
    })),
  };
}

function AdminWhyPage() {
  const { t } = useLanguage();
  const [data, setData] = useState<WhyContent>(() => seedWhy());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const payload: WhyContent = {
      eyebrow: pairLocalized(asLocalized(data.eyebrow).en, asLocalized(data.eyebrow).ar),
      title: pairLocalized(asLocalized(data.title).en, asLocalized(data.title).ar),
      items: data.items.map((item) => {
        const title = asLocalized(item.title);
        const description = asLocalized(item.description);
        return {
          title: pairLocalized(title.en, title.ar),
          description: pairLocalized(description.en, description.ar),
        };
      }),
    };
    const result = await saveWhy(payload);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
    setBusy(false);
  };

  const items = useMemo(() => data.items, [data.items]);

  return (
    <AdminLayout title={t("admin.nav.why")}>
      <div className="mb-6 flex items-center justify-between gap-3">
        {status ? <span className="text-xs text-navy/55">{status}</span> : <span />}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase hover:bg-navy/90 disabled:opacity-60"
        >
          {t("admin.content.save")}
        </button>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-2">
            <ModalField
              label={`${t("admin.content.heroTitle")} (EN)`}
              value={asLocalized(data.eyebrow).en}
              onChange={(value) =>
                setData({ ...data, eyebrow: { ...asLocalized(data.eyebrow), en: value } })
              }
            />
            <ModalField
              label={`${t("admin.content.heroTitle")} (AR)`}
              value={asLocalized(data.eyebrow).ar}
              onChange={(value) =>
                setData({ ...data, eyebrow: { ...asLocalized(data.eyebrow), ar: value } })
              }
            />
            <ModalField
              label={`${t("admin.table.title")} (EN)`}
              value={asLocalized(data.title).en}
              onChange={(value) =>
                setData({ ...data, title: { ...asLocalized(data.title), en: value } })
              }
            />
            <ModalField
              label={`${t("admin.table.title")} (AR)`}
              value={asLocalized(data.title).ar}
              onChange={(value) =>
                setData({ ...data, title: { ...asLocalized(data.title), ar: value } })
              }
            />
          </div>
        </section>

        <section className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg text-navy">{t("admin.why.items")}</h3>
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  items: [
                    ...data.items,
                    {
                      title: { en: "New reason", ar: "سبب جديد" },
                      description: { en: "Description", ar: "وصف" },
                    },
                  ],
                })
              }
              className="inline-flex items-center gap-2 rounded-full border border-navy/15 px-4 py-2 text-xs uppercase tracking-[0.16em] text-navy"
            >
              <Plus className="size-3.5" />
              {t("admin.actions.add")}
            </button>
          </div>
          <div className="space-y-4">
            {items.map((item, index) => {
              const title = asLocalized(item.title);
              const description = asLocalized(item.description);
              return (
                <div key={index} className="rounded-xl border border-navy/8 bg-sand p-4">
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(t("admin.actions.confirmDelete"))) return;
                        setData({
                          ...data,
                          items: data.items.filter((_, i) => i !== index),
                        });
                      }}
                      className="text-red-500"
                      aria-label={t("admin.actions.delete")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <ModalField
                      label={`${t("admin.table.title")} (EN)`}
                      value={title.en}
                      onChange={(value) => {
                        const next = [...data.items];
                        next[index] = {
                          ...item,
                          title: { ...title, en: value },
                        };
                        setData({ ...data, items: next });
                      }}
                    />
                    <ModalField
                      label={`${t("admin.table.title")} (AR)`}
                      value={title.ar}
                      onChange={(value) => {
                        const next = [...data.items];
                        next[index] = {
                          ...item,
                          title: { ...title, ar: value },
                        };
                        setData({ ...data, items: next });
                      }}
                    />
                    <ModalField
                      textarea
                      label={`${t("admin.table.description")} (EN)`}
                      value={description.en}
                      onChange={(value) => {
                        const next = [...data.items];
                        next[index] = {
                          ...item,
                          description: { ...description, en: value },
                        };
                        setData({ ...data, items: next });
                      }}
                    />
                    <ModalField
                      textarea
                      label={`${t("admin.table.description")} (AR)`}
                      value={description.ar}
                      onChange={(value) => {
                        const next = [...data.items];
                        next[index] = {
                          ...item,
                          description: { ...description, ar: value },
                        };
                        setData({ ...data, items: next });
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
