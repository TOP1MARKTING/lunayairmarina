import { useEffect, useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DataTable, RowAction, type Column } from "@/components/admin/DataTable";
import { Modal, ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { adminDisplayLocalized, asLocalized, pairLocalized } from "@/lib/localized";
import { describeSaveResult, loadTestimonials, saveTestimonials } from "@/services/adminCmsService";
import type { TestimonialContent } from "@/types/content";

export const Route = createLazyFileRoute("/admin/testimonials")({
  component: AdminTestimonialsPage,
});

type Draft = {
  nameEn: string;
  nameAr: string;
  positionEn: string;
  positionAr: string;
  reviewEn: string;
  reviewAr: string;
};

const emptyDraft = (): Draft => ({
  nameEn: "",
  nameAr: "",
  positionEn: "",
  positionAr: "",
  reviewEn: "",
  reviewAr: "",
});

function normalizeTestimonials(rows: TestimonialContent[]): TestimonialContent[] {
  return rows.map((row) => ({
    ...row,
    clientName: asLocalized(row.clientName),
    role: asLocalized(row.role),
    text: asLocalized(row.text),
  }));
}

function AdminTestimonialsPage() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<TestimonialContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const testimonials = await loadTestimonials();
      if (!cancelled) {
        setRows(normalizeTestimonials(testimonials));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: TestimonialContent[]) => {
    setRows(next);
    const result = await saveTestimonials(next);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
  };

  const save = async () => {
    if (!draft.nameEn.trim() && !draft.nameAr.trim()) return;
    const clientName = pairLocalized(draft.nameEn, draft.nameAr);
    const role = pairLocalized(draft.positionEn, draft.positionAr);
    const text = pairLocalized(draft.reviewEn, draft.reviewAr);

    const next = editingId
      ? rows.map((row) => (row.id === editingId ? { ...row, clientName, role, text } : row))
      : [
          ...rows,
          {
            id: `t${Date.now()}`,
            clientName,
            role,
            text,
            order: rows.length + 1,
          },
        ];
    await persist(next);
    setOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const columns: Column<TestimonialContent>[] = useMemo(
    () => [
      {
        key: "photo",
        header: t("admin.table.image"),
        render: (row) => {
          const name = adminDisplayLocalized(row.clientName, language);
          return (
            <span className="grid size-11 place-items-center rounded-full bg-navy/6 text-xs text-navy">
              {name.slice(0, 2).toUpperCase() || "LM"}
            </span>
          );
        },
      },
      {
        key: "name",
        header: t("admin.table.name"),
        render: (row) => (
          <span className="text-navy" dir="auto">
            {adminDisplayLocalized(row.clientName, language)}
          </span>
        ),
      },
      {
        key: "position",
        header: t("admin.table.position"),
        render: (row) => <span dir="auto">{adminDisplayLocalized(row.role, language)}</span>,
      },
      {
        key: "review",
        header: t("admin.table.review"),
        render: (row) => (
          <span className="line-clamp-2 max-w-sm text-muted-foreground" dir="auto">
            {adminDisplayLocalized(row.text, language)}
          </span>
        ),
      },
    ],
    [language, t],
  );

  return (
    <AdminLayout title={t("admin.nav.testimonials")}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-navy/55">
          {status ?? (loading ? t("common.loading") : null)}
        </span>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft(emptyDraft());
            setOpen(true);
          }}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90 sm:w-auto"
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
              onClick={() => {
                const name = asLocalized(row.clientName);
                const role = asLocalized(row.role);
                const text = asLocalized(row.text);
                setEditingId(row.id);
                setDraft({
                  nameEn: name.en,
                  nameAr: name.ar,
                  positionEn: role.en,
                  positionAr: role.ar,
                  reviewEn: text.en,
                  reviewAr: text.ar,
                });
                setOpen(true);
              }}
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
        open={open}
        title={editingId ? t("admin.actions.edit") : t("admin.actions.add")}
        onClose={() => setOpen(false)}
        onSubmit={() => void save()}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <ModalField
            label={`${t("admin.table.name")} (EN)`}
            value={draft.nameEn}
            onChange={(value) => setDraft({ ...draft, nameEn: value })}
          />
          <ModalField
            label={`${t("admin.table.name")} (AR)`}
            value={draft.nameAr}
            onChange={(value) => setDraft({ ...draft, nameAr: value })}
          />
          <ModalField
            label={`${t("admin.table.position")} (EN)`}
            value={draft.positionEn}
            onChange={(value) => setDraft({ ...draft, positionEn: value })}
          />
          <ModalField
            label={`${t("admin.table.position")} (AR)`}
            value={draft.positionAr}
            onChange={(value) => setDraft({ ...draft, positionAr: value })}
          />
        </div>
        <ModalField
          textarea
          label={`${t("admin.table.review")} (EN)`}
          value={draft.reviewEn}
          onChange={(value) => setDraft({ ...draft, reviewEn: value })}
        />
        <ModalField
          textarea
          label={`${t("admin.table.review")} (AR)`}
          value={draft.reviewAr}
          onChange={(value) => setDraft({ ...draft, reviewAr: value })}
        />
      </Modal>
    </AdminLayout>
  );
}
