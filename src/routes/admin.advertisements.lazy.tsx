import { useEffect, useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Eye, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DataTable, RowAction, StatusBadge, type Column } from "@/components/admin/DataTable";
import { Modal, ModalField } from "@/components/admin/Modal";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { ResolvedImage } from "@/components/shared/ResolvedImage";
import { useLanguage } from "@/lib/i18n";
import { asLocalized, pairLocalized } from "@/lib/localized";
import {
  getAdvertisementEffectiveStatus,
  getAdvertisementPackage,
  localIsoDate,
  normalizeAdvertisementWebsiteUrl,
  type AdvertisementEffectiveStatus,
} from "@/lib/advertisements";
import {
  describeSaveResult,
  loadAdvertisements,
  saveAdvertisements,
} from "@/services/adminCmsService";
import type {
  AdvertisementContent,
  AdvertisementPackage,
  AdvertisementStatus,
} from "@/types/content";

export const Route = createLazyFileRoute("/admin/advertisements")({
  component: AdminAdvertisementsPage,
});

type Draft = {
  companyNameEn: string;
  companyNameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  categoryEn: string;
  categoryAr: string;
  ctaLabelEn: string;
  ctaLabelAr: string;
  logo: string;
  image: string;
  websiteUrl: string;
  startDate: string;
  endDate: string;
  status: AdvertisementStatus;
  package: AdvertisementPackage;
  displayOrder: string;
};

const emptyDraft = (): Draft => {
  const start = localIsoDate();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);
  return {
    companyNameEn: "",
    companyNameAr: "",
    descriptionEn: "",
    descriptionAr: "",
    categoryEn: "",
    categoryAr: "",
    ctaLabelEn: "Visit Website",
    ctaLabelAr: "زيارة الموقع",
    logo: "",
    image: "",
    websiteUrl: "",
    startDate: start,
    endDate: localIsoDate(endDate),
    status: "active",
    package: "standard",
    displayOrder: "1",
  };
};

function normalizeRows(rows: AdvertisementContent[]): AdvertisementContent[] {
  return rows.map((row) => ({
    ...row,
    companyName: asLocalized(row.companyName),
    description: asLocalized(row.description),
    category: row.category ? asLocalized(row.category) : { en: "", ar: "" },
    ctaLabel: asLocalized(row.ctaLabel),
  }));
}

function statusTone(
  status: AdvertisementEffectiveStatus,
): "active" | "draft" | "scheduled" | "expired" | "paused" {
  return status;
}

function AdminAdvertisementsPage() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<AdvertisementContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<AdvertisementContent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const ads = await loadAdvertisements();
      if (!cancelled) {
        setRows(normalizeRows(ads));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: AdvertisementContent[]) => {
    setRows(next);
    const result = await saveAdvertisements(next);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
  };

  const save = async () => {
    if (!draft.companyNameEn.trim() && !draft.companyNameAr.trim()) return;
    if (!draft.startDate || !draft.endDate) return;
    if (draft.endDate < draft.startDate) {
      setStatus(t("admin.advertisements.invalidDates"));
      return;
    }

    const companyName = pairLocalized(draft.companyNameEn, draft.companyNameAr);
    const description = pairLocalized(draft.descriptionEn, draft.descriptionAr);
    const category = pairLocalized(draft.categoryEn, draft.categoryAr);
    const ctaLabel = pairLocalized(draft.ctaLabelEn, draft.ctaLabelAr);
    const websiteUrl = normalizeAdvertisementWebsiteUrl(draft.websiteUrl);
    const displayOrder = Number(draft.displayOrder) || rows.length + 1;
    const nowIso = new Date().toISOString();
    const pkg = draft.package;
    const featured = pkg === "featured" || pkg === "vip";

    const next = editingId
      ? rows.map((row) =>
          row.id === editingId
            ? {
                ...row,
                companyName,
                description,
                category,
                ctaLabel,
                logo: draft.logo || row.logo,
                image: draft.image || row.image,
                websiteUrl,
                startDate: draft.startDate,
                endDate: draft.endDate,
                status: draft.status,
                package: pkg,
                featured,
                displayOrder,
                updatedAt: nowIso,
              }
            : row,
        )
      : [
          ...rows,
          {
            id: `ad${Date.now()}`,
            companyName,
            description,
            category,
            ctaLabel,
            logo: draft.logo,
            image: draft.image,
            websiteUrl,
            startDate: draft.startDate,
            endDate: draft.endDate,
            status: draft.status,
            package: pkg,
            featured,
            displayOrder,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];

    await persist(next);
    setOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const setManualStatus = async (id: string, nextStatus: AdvertisementStatus) => {
    await persist(
      rows.map((row) =>
        row.id === id ? { ...row, status: nextStatus, updatedAt: new Date().toISOString() } : row,
      ),
    );
  };

  const columns: Column<AdvertisementContent>[] = useMemo(
    () => [
      {
        key: "company",
        header: t("admin.advertisements.company"),
        render: (row) => (
          <div className="flex items-center gap-3">
            {row.logo ? (
              <ResolvedImage src={row.logo} alt="" className="size-10 rounded-full object-cover" />
            ) : (
              <span className="grid size-10 place-items-center rounded-full bg-navy/6 text-[0.65rem]">
                {row.companyName[language].slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-navy">{row.companyName[language]}</p>
              <p className="text-[0.65rem] tracking-[0.14em] text-gold uppercase">
                {t(`admin.advertisements.packages.${getAdvertisementPackage(row)}`)}
              </p>
            </div>
          </div>
        ),
      },
      {
        key: "status",
        header: t("admin.table.status"),
        render: (row) => {
          const effective = getAdvertisementEffectiveStatus(row);
          return (
            <StatusBadge
              tone={statusTone(effective)}
              label={t(`admin.advertisements.status.${effective}`)}
            />
          );
        },
      },
      {
        key: "start",
        header: t("admin.advertisements.start"),
        render: (row) => <span dir="ltr">{row.startDate}</span>,
      },
      {
        key: "end",
        header: t("admin.advertisements.end"),
        render: (row) => <span dir="ltr">{row.endDate}</span>,
      },
      {
        key: "package",
        header: t("admin.advertisements.package"),
        render: (row) => t(`admin.advertisements.packages.${getAdvertisementPackage(row)}`),
      },
      {
        key: "featured",
        header: t("admin.advertisements.featured"),
        render: (row) => {
          const pkg = getAdvertisementPackage(row);
          return pkg === "standard" ? t("common.no") : t("common.yes");
        },
      },
      {
        key: "order",
        header: t("admin.advertisements.order"),
        render: (row) => row.displayOrder ?? "—",
      },
    ],
    [language, t],
  );

  return (
    <AdminLayout title={t("admin.nav.advertisements")}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="text-xs text-navy/55">
          {status ?? (loading ? t("common.loading") : null)}
        </span>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft({
              ...emptyDraft(),
              displayOrder: String(rows.length + 1),
            });
            setOpen(true);
          }}
          className="flex items-center gap-2 rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase hover:bg-navy/90"
        >
          <Plus className="size-4" />
          {t("admin.actions.add")}
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        actions={(row) => {
          const effective = getAdvertisementEffectiveStatus(row);
          return (
            <>
              <RowAction
                icon={Eye}
                label={t("admin.advertisements.preview")}
                onClick={() => {
                  setPreviewRow(row);
                  setPreviewOpen(true);
                }}
              />
              <RowAction
                icon={Pencil}
                label={t("admin.actions.edit")}
                onClick={() => {
                  const companyName = asLocalized(row.companyName);
                  const description = asLocalized(row.description);
                  const category = asLocalized(row.category);
                  const ctaLabel = asLocalized(row.ctaLabel);
                  setEditingId(row.id);
                  setDraft({
                    companyNameEn: companyName.en,
                    companyNameAr: companyName.ar,
                    descriptionEn: description.en,
                    descriptionAr: description.ar,
                    categoryEn: category.en,
                    categoryAr: category.ar,
                    ctaLabelEn: ctaLabel.en || "Visit Website",
                    ctaLabelAr: ctaLabel.ar || "زيارة الموقع",
                    logo: row.logo,
                    image: row.image,
                    websiteUrl: row.websiteUrl,
                    startDate: row.startDate,
                    endDate: row.endDate,
                    status:
                      row.status === "draft" || row.status === "paused" ? row.status : "active",
                    package: getAdvertisementPackage(row),
                    displayOrder: String(row.displayOrder ?? 1),
                  });
                  setOpen(true);
                }}
              />
              {effective === "paused" || row.status === "paused" ? (
                <RowAction
                  icon={Play}
                  label={t("admin.advertisements.resume")}
                  onClick={() => void setManualStatus(row.id, "active")}
                />
              ) : (
                <RowAction
                  icon={Pause}
                  label={t("admin.advertisements.pause")}
                  onClick={() => void setManualStatus(row.id, "paused")}
                />
              )}
              <RowAction
                icon={Trash2}
                tone="danger"
                label={t("admin.actions.delete")}
                onClick={() => void persist(rows.filter((item) => item.id !== row.id))}
              />
            </>
          );
        }}
      />

      <Modal
        open={open}
        title={editingId ? t("admin.actions.edit") : t("admin.actions.add")}
        onClose={() => setOpen(false)}
        onSubmit={() => void save()}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <ModalField
            label={`${t("admin.advertisements.company")} (EN)`}
            value={draft.companyNameEn}
            onChange={(value) => setDraft({ ...draft, companyNameEn: value })}
          />
          <ModalField
            label={`${t("admin.advertisements.company")} (AR)`}
            value={draft.companyNameAr}
            onChange={(value) => setDraft({ ...draft, companyNameAr: value })}
          />
        </div>
        <ModalField
          textarea
          label={`${t("admin.table.description")} (EN)`}
          value={draft.descriptionEn}
          onChange={(value) => setDraft({ ...draft, descriptionEn: value })}
        />
        <ModalField
          textarea
          label={`${t("admin.table.description")} (AR)`}
          value={draft.descriptionAr}
          onChange={(value) => setDraft({ ...draft, descriptionAr: value })}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <ModalField
            label={`${t("admin.advertisements.category")} (EN)`}
            value={draft.categoryEn}
            onChange={(value) => setDraft({ ...draft, categoryEn: value })}
          />
          <ModalField
            label={`${t("admin.advertisements.category")} (AR)`}
            value={draft.categoryAr}
            onChange={(value) => setDraft({ ...draft, categoryAr: value })}
          />
          <ModalField
            label={`${t("admin.advertisements.ctaLabel")} (EN)`}
            value={draft.ctaLabelEn}
            onChange={(value) => setDraft({ ...draft, ctaLabelEn: value })}
          />
          <ModalField
            label={`${t("admin.advertisements.ctaLabel")} (AR)`}
            value={draft.ctaLabelAr}
            onChange={(value) => setDraft({ ...draft, ctaLabelAr: value })}
          />
          <ModalField
            label={t("admin.advertisements.websiteUrl")}
            value={draft.websiteUrl}
            onChange={(value) => setDraft({ ...draft, websiteUrl: value })}
          />
          <div>
            <label className="mb-2 block text-[0.65rem] tracking-[0.16em] text-navy/55 uppercase">
              {t("admin.table.status")}
            </label>
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as AdvertisementStatus,
                })
              }
              className="w-full rounded-xl border border-navy/15 bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="active">{t("admin.advertisements.status.active")}</option>
              <option value="draft">{t("admin.advertisements.status.draft")}</option>
              <option value="paused">{t("admin.advertisements.status.paused")}</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[0.65rem] tracking-[0.16em] text-navy/55 uppercase">
              {t("admin.advertisements.package")}
            </label>
            <select
              value={draft.package}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  package: event.target.value as AdvertisementPackage,
                })
              }
              className="w-full rounded-xl border border-navy/15 bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="standard">{t("admin.advertisements.packages.standard")}</option>
              <option value="featured">{t("admin.advertisements.packages.featured")}</option>
              <option value="vip">{t("admin.advertisements.packages.vip")}</option>
            </select>
            <p className="mt-1.5 text-xs text-navy/45">
              {t(`admin.advertisements.packageHints.${draft.package}`)}
            </p>
          </div>
          <ModalField
            label={t("admin.advertisements.start")}
            type="date"
            value={draft.startDate}
            onChange={(value) => setDraft({ ...draft, startDate: value })}
          />
          <ModalField
            label={t("admin.advertisements.end")}
            type="date"
            value={draft.endDate}
            onChange={(value) => setDraft({ ...draft, endDate: value })}
          />
          <ModalField
            label={t("admin.advertisements.order")}
            value={draft.displayOrder}
            onChange={(value) => setDraft({ ...draft, displayOrder: value })}
          />
        </div>
        <MediaUploader
          label={t("admin.advertisements.logo")}
          value={draft.logo}
          pathPrefix="images/advertisements/logos"
          onChange={(url) => setDraft({ ...draft, logo: url })}
        />
        <MediaUploader
          label={t("admin.advertisements.image")}
          value={draft.image}
          pathPrefix="images/advertisements"
          onChange={(url) => setDraft({ ...draft, image: url })}
        />
      </Modal>

      <Modal
        open={previewOpen}
        title={t("admin.advertisements.preview")}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewRow(null);
        }}
      >
        {previewRow ? (
          <div className="overflow-hidden rounded-2xl border border-navy/10 bg-[#fbfaf7]">
            {previewRow.image ? (
              <ResolvedImage
                src={previewRow.image}
                alt=""
                className="aspect-[16/10] w-full object-cover"
              />
            ) : null}
            <div className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                {previewRow.logo ? (
                  <ResolvedImage
                    src={previewRow.logo}
                    alt=""
                    className="size-12 rounded-full object-cover"
                  />
                ) : null}
                <div>
                  <p className="font-display text-xl text-navy">
                    {previewRow.companyName[language]}
                  </p>
                  {previewRow.category?.[language] ? (
                    <p className="text-xs tracking-[0.16em] text-gold uppercase">
                      {previewRow.category[language]}
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {previewRow.description[language]}
              </p>
              <p className="text-xs text-navy/55" dir="ltr">
                {previewRow.startDate} → {previewRow.endDate}
              </p>
              {normalizeAdvertisementWebsiteUrl(previewRow.websiteUrl) ? (
                <a
                  href={normalizeAdvertisementWebsiteUrl(previewRow.websiteUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex border border-navy bg-navy px-5 py-2.5 text-[0.68rem] tracking-[0.16em] text-white uppercase"
                >
                  {previewRow.ctaLabel[language] || t("advertising.visitWebsite")}
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </AdminLayout>
  );
}
