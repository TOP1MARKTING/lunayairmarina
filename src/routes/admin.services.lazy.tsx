import { useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminStatusToggle, DataTable, RowAction, type Column } from "@/components/admin/DataTable";
import { Modal, ModalField } from "@/components/admin/Modal";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { useLanguage } from "@/lib/i18n";
import { asLocalized, pairLocalized } from "@/lib/localized";
import { serviceRecords } from "@/data/mock";
import { SERVICE_SLUGS } from "@/data/services";
import { loadCmsStore } from "@/lib/cms-store";
import { describeSaveResult, saveServices } from "@/services/adminCmsService";
import { ResolvedImage } from "@/components/shared/ResolvedImage";
import type { ServiceContent } from "@/types/content";

export const Route = createLazyFileRoute("/admin/services")({
  component: AdminServicesPage,
});

type Draft = {
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  featuresEn: string;
  featuresAr: string;
  image: string;
  slug: string;
};

function isServiceActive(row: ServiceContent) {
  return (row.details as { status?: string } | undefined)?.status !== "draft";
}

function slugifyService(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const emptyDraft = (): Draft => ({
  titleEn: "",
  titleAr: "",
  descriptionEn: "",
  descriptionAr: "",
  featuresEn: "",
  featuresAr: "",
  image: "",
  slug: "",
});

function toServiceContent(): ServiceContent[] {
  const cms = loadCmsStore();
  if (cms.services.length) {
    return cms.services.map((row) => ({
      ...row,
      title: asLocalized(row.title),
      description: asLocalized(row.description),
      features: (row.features ?? []).map((feature) => asLocalized(feature)),
    }));
  }
  return serviceRecords.map((row, index) => ({
    id: row.id,
    slug: SERVICE_SLUGS[index] ?? row.id,
    title: asLocalized(row.title),
    description: asLocalized(row.description),
    image: row.image,
    features: [],
    order: index + 1,
    details: { status: row.status },
  }));
}

function AdminServicesPage() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<ServiceContent[]>(() => toServiceContent());
  const [editing, setEditing] = useState<ServiceContent | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [status, setStatus] = useState<string | null>(null);

  const persist = async (next: ServiceContent[]) => {
    setRows(next);
    const result = await saveServices(next);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
  };

  const openEdit = (row: ServiceContent) => {
    const title = asLocalized(row.title);
    const description = asLocalized(row.description);
    const features = (row.features ?? []).map((feature) => asLocalized(feature));
    setEditing(row);
    setDraft({
      titleEn: title.en,
      titleAr: title.ar,
      descriptionEn: description.en,
      descriptionAr: description.ar,
      featuresEn: features
        .map((feature) => feature.en)
        .filter(Boolean)
        .join("\n"),
      featuresAr: features
        .map((feature) => feature.ar)
        .filter(Boolean)
        .join("\n"),
      image: row.image,
      slug: row.slug,
    });
  };

  const save = async () => {
    if (!editing) return;
    const enLines = draft.featuresEn
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const arLines = draft.featuresAr
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const featureCount = Math.max(enLines.length, arLines.length);
    const features = Array.from({ length: featureCount }, (_, index) =>
      pairLocalized(enLines[index] ?? "", arLines[index] ?? ""),
    );
    const next = rows.map((row) =>
      row.id === editing.id
        ? {
            ...row,
            slug: slugifyService(draft.slug || draft.titleEn) || row.slug,
            image: draft.image || row.image,
            title: pairLocalized(draft.titleEn, draft.titleAr),
            description: pairLocalized(draft.descriptionEn, draft.descriptionAr),
            features,
          }
        : row,
    );
    await persist(next);
    setEditing(null);
  };

  const addNew = async () => {
    const id = `s${Date.now()}`;
    const slugBase = `service-${Date.now()}`;
    const row: ServiceContent = {
      id,
      slug: slugBase,
      title: { en: "New service", ar: "خدمة جديدة" },
      description: { en: "Service description", ar: "وصف الخدمة" },
      image: serviceRecords[0]?.image ?? "",
      features: [],
      order: rows.length + 1,
      details: { status: "draft" },
    };
    await persist([...rows, row]);
    openEdit(row);
  };

  const toggleStatus = async (row: ServiceContent) => {
    const nextStatus = isServiceActive(row) ? "draft" : "active";
    await persist(
      rows.map((item) =>
        item.id === row.id
          ? {
              ...item,
              details: {
                ...(item.details ?? {}),
                status: nextStatus,
              },
            }
          : item,
      ),
    );
  };

  const columns: Column<ServiceContent>[] = useMemo(
    () => [
      {
        key: "image",
        header: t("admin.table.image"),
        render: (row) => (
          <ResolvedImage
            src={row.image}
            alt=""
            loading="lazy"
            className="size-14 rounded-md object-cover"
          />
        ),
      },
      {
        key: "title",
        header: t("admin.table.title"),
        render: (row) => <span className="text-navy">{asLocalized(row.title)[language]}</span>,
      },
      {
        key: "description",
        header: t("admin.table.description"),
        render: (row) => (
          <span className="line-clamp-2 max-w-sm text-muted-foreground">
            {asLocalized(row.description)[language]}
          </span>
        ),
      },
      {
        key: "status",
        header: t("admin.table.status"),
        render: (row) => {
          const active = isServiceActive(row);
          return (
            <AdminStatusToggle
              active={active}
              activeLabel={t("admin.status.active")}
              draftLabel={t("admin.status.draft")}
              onChange={() => void toggleStatus(row)}
            />
          );
        },
      },
    ],
    [language, t],
  );

  return (
    <AdminLayout title={t("admin.nav.services")}>
      <div className="mb-6 flex items-center justify-between gap-3">
        {status ? <span className="text-xs text-navy/55">{status}</span> : <span />}
        <button
          type="button"
          onClick={() => void addNew()}
          className="flex items-center gap-2 rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90"
        >
          <Plus className="size-4" strokeWidth={1.5} />
          {t("admin.actions.add")}
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        actions={(row) => (
            <>
              <RowAction
                icon={Pencil}
                label={t("admin.actions.edit")}
                onClick={() => openEdit(row)}
              />
              <RowAction
                icon={Trash2}
                tone="danger"
                label={t("admin.actions.delete")}
                onClick={() => void persist(rows.filter((item) => item.id !== row.id))}
              />
            </>
          )}
        />

      <Modal
        open={Boolean(editing)}
        title={t("admin.actions.edit")}
        onClose={() => setEditing(null)}
        onSubmit={() => void save()}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <ModalField
            label={`${t("admin.table.title")} (EN)`}
            value={draft.titleEn}
            onChange={(value) => setDraft({ ...draft, titleEn: value })}
          />
          <ModalField
            label={`${t("admin.table.title")} (AR)`}
            value={draft.titleAr}
            onChange={(value) => setDraft({ ...draft, titleAr: value })}
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
        <ModalField
          label={t("admin.blog.slug")}
          value={draft.slug}
          onChange={(value) => setDraft({ ...draft, slug: slugifyService(value) })}
        />
        <ModalField
          textarea
          label="Features (EN, one per line)"
          value={draft.featuresEn}
          onChange={(value) => setDraft({ ...draft, featuresEn: value })}
        />
        <ModalField
          textarea
          label="Features (AR, one per line)"
          value={draft.featuresAr}
          onChange={(value) => setDraft({ ...draft, featuresAr: value })}
        />
        <MediaUploader
          label={t("admin.table.image")}
          value={draft.image}
          pathPrefix="images/services"
          onChange={(url) => setDraft({ ...draft, image: url })}
        />
      </Modal>
    </AdminLayout>
  );
}
