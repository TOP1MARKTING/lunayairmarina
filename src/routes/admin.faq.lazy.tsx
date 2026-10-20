import { useEffect, useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DataTable, RowAction, type Column } from "@/components/admin/DataTable";
import { Modal, ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { adminDisplayLocalized, asLocalized, pairLocalized } from "@/lib/localized";
import { describeSaveResult, loadFaq, saveFaq } from "@/services/adminCmsService";
import type { FaqContent } from "@/types/content";

export const Route = createLazyFileRoute("/admin/faq")({
  component: AdminFaqPage,
});

type Draft = {
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
};

const emptyDraft = (): Draft => ({
  questionEn: "",
  questionAr: "",
  answerEn: "",
  answerAr: "",
});

function normalizeFaq(rows: FaqContent[]): FaqContent[] {
  return rows.map((row) => ({
    ...row,
    question: asLocalized(row.question),
    answer: asLocalized(row.answer),
  }));
}

function AdminFaqPage() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<FaqContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const faq = await loadFaq();
      if (!cancelled) {
        setRows(normalizeFaq(faq));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: FaqContent[]) => {
    setRows(next);
    const result = await saveFaq(next);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
  };

  const save = async () => {
    if (!draft.questionEn.trim() && !draft.questionAr.trim()) return;
    const question = pairLocalized(draft.questionEn, draft.questionAr);
    const answer = pairLocalized(draft.answerEn, draft.answerAr);
    const next = editingId
      ? rows.map((row) => (row.id === editingId ? { ...row, question, answer } : row))
      : [
          ...rows,
          {
            id: `f${Date.now()}`,
            question,
            answer,
            order: rows.length + 1,
          },
        ];
    await persist(next);
    setOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const columns: Column<FaqContent>[] = useMemo(
    () => [
      {
        key: "question",
        header: t("admin.table.question"),
        render: (row) => (
          <span className="text-navy" dir="auto">
            {adminDisplayLocalized(row.question, language)}
          </span>
        ),
      },
      {
        key: "answer",
        header: t("admin.table.answer"),
        render: (row) => (
          <span className="line-clamp-2 max-w-lg text-muted-foreground" dir="auto">
            {adminDisplayLocalized(row.answer, language)}
          </span>
        ),
      },
    ],
    [language, t],
  );

  return (
    <AdminLayout title={t("admin.nav.faq")}>
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
                const question = asLocalized(row.question);
                const answer = asLocalized(row.answer);
                setEditingId(row.id);
                setDraft({
                  questionEn: question.en,
                  questionAr: question.ar,
                  answerEn: answer.en,
                  answerAr: answer.ar,
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
        <ModalField
          label={`${t("admin.table.question")} (EN)`}
          value={draft.questionEn}
          onChange={(value) => setDraft({ ...draft, questionEn: value })}
        />
        <ModalField
          label={`${t("admin.table.question")} (AR)`}
          value={draft.questionAr}
          onChange={(value) => setDraft({ ...draft, questionAr: value })}
        />
        <ModalField
          textarea
          label={`${t("admin.table.answer")} (EN)`}
          value={draft.answerEn}
          onChange={(value) => setDraft({ ...draft, answerEn: value })}
        />
        <ModalField
          textarea
          label={`${t("admin.table.answer")} (AR)`}
          value={draft.answerAr}
          onChange={(value) => setDraft({ ...draft, answerAr: value })}
        />
      </Modal>
    </AdminLayout>
  );
}
