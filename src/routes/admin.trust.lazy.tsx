import { useRef, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { asLocalized, pairLocalized } from "@/lib/localized";
import { loadCmsStore } from "@/lib/cms-store";
import { describeSaveResult, saveTrust } from "@/services/adminCmsService";
import type { LocalizedString, TrustContent } from "@/types/content";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";

export const Route = createLazyFileRoute("/admin/trust")({
  component: AdminTrustPage,
});

type TrustSlot = TrustContent["slots"][number] & { id: string };

function coerceLocalized(value: unknown, fallback = ""): LocalizedString {
  return asLocalized(value as LocalizedString | string | undefined | null, fallback);
}

function makeSlotId() {
  return `trust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSlot(raw: unknown, index: number): TrustSlot {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: typeof item.id === "string" ? item.id : `trust-seed-${index}`,
    title: coerceLocalized(item.title, "New slot"),
    body: coerceLocalized(item.body, "Coming soon"),
  };
}

function emptySlot(): TrustSlot {
  return {
    id: makeSlotId(),
    title: { en: "New slot", ar: "خانة جديدة" },
    body: { en: "Coming soon", ar: "قريبًا" },
  };
}

function seedTrust(): { meta: Omit<TrustContent, "slots">; slots: TrustSlot[] } {
  const cms = loadCmsStore();
  const enSlots = (enLocale as { trust: { slots: Array<{ title: string; body: string }> } }).trust
    .slots;
  const arSlots = (arLocale as { trust: { slots: Array<{ title: string; body: string }> } }).trust
    .slots;

  const fallbackSlots = enSlots.map((slot, index) =>
    normalizeSlot(
      {
        title: { en: slot.title, ar: arSlots[index]?.title ?? slot.title },
        body: { en: slot.body, ar: arSlots[index]?.body ?? slot.body },
      },
      index,
    ),
  );

  const source = cms.trust;
  if (!source) {
    return {
      meta: {
        eyebrow: { en: enLocale.trust.eyebrow, ar: arLocale.trust.eyebrow },
        title: { en: enLocale.trust.title, ar: arLocale.trust.title },
        lead: { en: enLocale.trust.lead, ar: arLocale.trust.lead },
        cta: { en: enLocale.trust.cta, ar: arLocale.trust.cta },
      },
      slots: fallbackSlots,
    };
  }

  const rawSlots = Array.isArray(source.slots) ? source.slots : fallbackSlots;
  return {
    meta: {
      eyebrow: asLocalized(source.eyebrow, enLocale.trust.eyebrow),
      title: asLocalized(source.title, enLocale.trust.title),
      lead: asLocalized(source.lead, enLocale.trust.lead),
      cta: asLocalized(source.cta, enLocale.trust.cta),
    },
    slots: rawSlots.map((slot, index) => normalizeSlot(slot, index)),
  };
}

function toTrustContent(meta: Omit<TrustContent, "slots">, slots: TrustSlot[]): TrustContent {
  return {
    eyebrow: pairLocalized(asLocalized(meta.eyebrow).en, asLocalized(meta.eyebrow).ar),
    title: pairLocalized(asLocalized(meta.title).en, asLocalized(meta.title).ar),
    lead: pairLocalized(asLocalized(meta.lead).en, asLocalized(meta.lead).ar),
    cta: pairLocalized(asLocalized(meta.cta).en, asLocalized(meta.cta).ar),
    slots: slots.map(({ title, body }) => {
      const nextTitle = asLocalized(title);
      const nextBody = asLocalized(body);
      return {
        title: pairLocalized(nextTitle.en, nextTitle.ar),
        body: pairLocalized(nextBody.en, nextBody.ar),
      };
    }),
  };
}

function AdminTrustPage() {
  const { t } = useLanguage();
  const seeded = seedTrust();
  const [meta, setMeta] = useState(seeded.meta);
  const [slots, setSlots] = useState<TrustSlot[]>(seeded.slots);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const addSlot = () => {
    const next = emptySlot();
    setSlots((prev) => [...(Array.isArray(prev) ? prev : []), next]);
    setHighlightId(next.id);
    setStatus(t("admin.trust.slotAdded"));
    requestAnimationFrame(() => {
      listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((slot) => slot.id !== id));
  };

  const updateSlot = (id: string, patch: Partial<Pick<TrustSlot, "title" | "body">>) => {
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  };

  const save = async () => {
    setBusy(true);
    const result = await saveTrust(toTrustContent(meta, slots));
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
    setBusy(false);
  };

  const eyebrow = asLocalized(meta.eyebrow);
  const title = asLocalized(meta.title);
  const lead = asLocalized(meta.lead);
  const cta = asLocalized(meta.cta);

  return (
    <AdminLayout title={t("admin.nav.trust")}>
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
              label="Eyebrow (EN)"
              value={eyebrow.en}
              onChange={(value) => setMeta({ ...meta, eyebrow: { ...eyebrow, en: value } })}
            />
            <ModalField
              label="Eyebrow (AR)"
              value={eyebrow.ar}
              onChange={(value) => setMeta({ ...meta, eyebrow: { ...eyebrow, ar: value } })}
            />
            <ModalField
              label={`${t("admin.table.title")} (EN)`}
              value={title.en}
              onChange={(value) => setMeta({ ...meta, title: { ...title, en: value } })}
            />
            <ModalField
              label={`${t("admin.table.title")} (AR)`}
              value={title.ar}
              onChange={(value) => setMeta({ ...meta, title: { ...title, ar: value } })}
            />
            <ModalField
              textarea
              label="Lead (EN)"
              value={lead.en}
              onChange={(value) => setMeta({ ...meta, lead: { ...lead, en: value } })}
            />
            <ModalField
              textarea
              label="Lead (AR)"
              value={lead.ar}
              onChange={(value) => setMeta({ ...meta, lead: { ...lead, ar: value } })}
            />
            <ModalField
              label="CTA (EN)"
              value={cta.en}
              onChange={(value) => setMeta({ ...meta, cta: { ...cta, en: value } })}
            />
            <ModalField
              label="CTA (AR)"
              value={cta.ar}
              onChange={(value) => setMeta({ ...meta, cta: { ...cta, ar: value } })}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-navy">{t("admin.trust.slots")}</h3>
              <p className="mt-1 text-xs text-navy/45">
                {slots.length} {t("admin.trust.slotsCount")}
              </p>
            </div>
            <button
              type="button"
              onClick={addSlot}
              className="relative z-10 inline-flex items-center gap-2 rounded-full border border-navy/15 bg-white px-4 py-2 text-xs uppercase tracking-[0.16em] text-navy transition-colors hover:border-navy/40 hover:bg-sand"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              {t("admin.actions.add")}
            </button>
          </div>

          <div className="space-y-4">
            {slots.map((slot, index) => {
              const slotTitle = asLocalized(slot.title);
              const slotBody = asLocalized(slot.body);
              return (
                <div
                  key={slot.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    highlightId === slot.id
                      ? "border-gold bg-gold/10"
                      : "border-navy/8 bg-sand"
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-[0.65rem] tracking-[0.16em] text-navy/40 uppercase">
                      {t("admin.trust.slotLabel")} #{index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(t("admin.actions.confirmDelete"))) return;
                        removeSlot(slot.id);
                      }}
                      aria-label={t("admin.actions.delete")}
                      className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <ModalField
                      label={`${t("admin.table.title")} (EN)`}
                      value={slotTitle.en}
                      onChange={(value) =>
                        updateSlot(slot.id, { title: { ...slotTitle, en: value } })
                      }
                    />
                    <ModalField
                      label={`${t("admin.table.title")} (AR)`}
                      value={slotTitle.ar}
                      onChange={(value) =>
                        updateSlot(slot.id, { title: { ...slotTitle, ar: value } })
                      }
                    />
                    <ModalField
                      textarea
                      label={`${t("admin.table.description")} (EN)`}
                      value={slotBody.en}
                      onChange={(value) =>
                        updateSlot(slot.id, { body: { ...slotBody, en: value } })
                      }
                    />
                    <ModalField
                      textarea
                      label={`${t("admin.table.description")} (AR)`}
                      value={slotBody.ar}
                      onChange={(value) =>
                        updateSlot(slot.id, { body: { ...slotBody, ar: value } })
                      }
                    />
                  </div>
                </div>
              );
            })}
            <div ref={listEndRef} />
          </div>

          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={addSlot}
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-navy/25 px-5 py-3 text-xs uppercase tracking-[0.16em] text-navy/70 transition-colors hover:border-navy/50 hover:text-navy"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              {t("admin.actions.add")}
            </button>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
