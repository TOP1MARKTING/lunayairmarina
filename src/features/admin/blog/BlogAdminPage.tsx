import { useMemo, useState } from "react";
import { ImageIcon, Link, ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DataTable, RowAction, StatusBadge, type Column } from "@/components/admin/DataTable";
import { Modal, ModalField } from "@/components/admin/Modal";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { useLanguage } from "@/lib/i18n";
import {
  loadBlogPosts,
  newBlockId,
  saveBlogPosts,
  slugify,
  tx,
  type BlogBlock,
  type BlogInline,
  type BlogPost,
  type Localized,
} from "@/data/blog";
import { saveBlogPosts as saveCmsBlogPosts } from "@/services/adminCmsService";
import type { BlogContent } from "@/types/content";
import { cn } from "@/lib/utils";
import gallery1 from "@/assets/gallery/gallery-01-marina.jpg";

type Draft = {
  titleEn: string;
  titleAr: string;
  slug: string;
  excerptEn: string;
  excerptAr: string;
  coverImage: string;
  coverAltEn: string;
  coverAltAr: string;
  authorEn: string;
  authorAr: string;
  categoryEn: string;
  categoryAr: string;
  status: "published" | "draft";
  featured: boolean;
  seoTitleEn: string;
  seoTitleAr: string;
  seoDescriptionEn: string;
  seoDescriptionAr: string;
  focusKeywordEn: string;
  focusKeywordAr: string;
  tagsEn: string;
  tagsAr: string;
  blocks: BlogBlock[];
};

const emptyLocalized = (en = "", ar = ""): Localized => ({ en, ar });

const emptyDraft = (): Draft => ({
  titleEn: "",
  titleAr: "",
  slug: "",
  excerptEn: "",
  excerptAr: "",
  coverImage: gallery1,
  coverAltEn: "",
  coverAltAr: "",
  authorEn: "lunayairmarina Editorial",
  authorAr: "فريق تحرير lunayairmarina",
  categoryEn: "",
  categoryAr: "",
  status: "draft",
  featured: false,
  seoTitleEn: "",
  seoTitleAr: "",
  seoDescriptionEn: "",
  seoDescriptionAr: "",
  focusKeywordEn: "",
  focusKeywordAr: "",
  tagsEn: "",
  tagsAr: "",
  blocks: [
    {
      id: newBlockId(),
      type: "paragraph",
      spans: [{ type: "text", text: emptyLocalized() }],
    },
  ],
});

function paragraphText(spans: BlogInline[], lang: "en" | "ar") {
  return spans.map((span) => tx(span.text, lang)).join("");
}

function splitOnce(full: string, keyword: string): [string, string, string] | null {
  if (!keyword || !full.includes(keyword)) return null;
  const index = full.indexOf(keyword);
  return [full.slice(0, index), keyword, full.slice(index + keyword.length)];
}

/** Wrap a keyword in EN and/or AR text without dropping the other language. */
function wrapKeywordInParagraph(
  spans: BlogInline[],
  keywordEn: string,
  keywordAr: string,
  href: string,
): BlogInline[] | null {
  const textEn = paragraphText(spans, "en");
  const textAr = paragraphText(spans, "ar");
  const enParts = keywordEn ? splitOnce(textEn, keywordEn) : null;
  const arParts = keywordAr ? splitOnce(textAr, keywordAr) : null;
  if (!href.trim() || (!enParts && !arParts)) return null;

  const beforeEn = enParts?.[0] ?? (arParts ? textEn : "");
  const beforeAr = arParts?.[0] ?? (enParts ? textAr : "");
  const afterEn = enParts?.[2] ?? "";
  const afterAr = arParts?.[2] ?? (enParts && !arParts ? "" : "");
  // When only one language matched, keep the unmatched language intact around the link:
  // unmatched full text stays in "before" and link word uses the provided keyword (or mirror).

  const next: BlogInline[] = [];
  const before =
    enParts && arParts
      ? { en: beforeEn, ar: beforeAr }
      : enParts
        ? { en: beforeEn, ar: textAr }
        : { en: textEn, ar: beforeAr };

  // If only one lang matched, putting full other lang in before means after should be empty for that lang
  const after =
    enParts && arParts
      ? { en: afterEn, ar: afterAr }
      : enParts
        ? { en: afterEn, ar: "" }
        : { en: "", ar: afterAr };

  if (before.en || before.ar) next.push({ type: "text", text: before });
  next.push({
    type: "keyword",
    text: {
      en: enParts?.[1] ?? (keywordEn || keywordAr),
      ar: arParts?.[1] ?? (keywordAr || keywordEn),
    },
    href: href.trim(),
  });
  if (after.en || after.ar) next.push({ type: "text", text: after });
  return next;
}

/** Update one language of a paragraph while re-applying existing keyword links when possible. */
function setParagraphLanguage(spans: BlogInline[], lang: "en" | "ar", value: string): BlogInline[] {
  const other: "en" | "ar" = lang === "en" ? "ar" : "en";
  const otherText = paragraphText(spans, other);
  const keywords = spans.filter(
    (span): span is Extract<BlogInline, { type: "keyword" }> => span.type === "keyword",
  );
  let next: BlogInline[] = [
    {
      type: "text",
      text: lang === "en" ? { en: value, ar: otherText } : { en: otherText, ar: value },
    },
  ];
  for (const keyword of keywords) {
    const wrapped = wrapKeywordInParagraph(
      next,
      tx(keyword.text, "en"),
      tx(keyword.text, "ar"),
      keyword.href,
    );
    if (wrapped) next = wrapped;
  }
  return next;
}

const fieldClass =
  "w-full rounded-md border border-navy/10 bg-white px-3 py-2 text-sm outline-none focus:border-navy/30";
const selectClass =
  "rounded-md border border-navy/10 bg-sand px-4 py-3 text-sm outline-none focus:border-navy/30";
const toolBtnClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-navy px-4 py-2.5 text-[0.65rem] tracking-[0.14em] text-white uppercase transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-50";

export function BlogAdminPage() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<BlogPost[]>(() => loadBlogPosts());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const [extLinkEn, setExtLinkEn] = useState("");
  const [extLinkAr, setExtLinkAr] = useState("");
  const [extUrl, setExtUrl] = useState("https://");
  const [extParagraphId, setExtParagraphId] = useState("");

  const [intLinkEn, setIntLinkEn] = useState("");
  const [intLinkAr, setIntLinkAr] = useState("");
  const [intHeadingId, setIntHeadingId] = useState("");
  const [intParagraphId, setIntParagraphId] = useState("");

  const [imgSrc, setImgSrc] = useState("");
  const [imgAltEn, setImgAltEn] = useState("");
  const [imgAltAr, setImgAltAr] = useState("");
  const [imgCaptionEn, setImgCaptionEn] = useState("");
  const [imgCaptionAr, setImgCaptionAr] = useState("");
  const [cursorBlockId, setCursorBlockId] = useState("");

  const paragraphBlocks = useMemo(
    () =>
      draft.blocks
        .map((block, index) => ({ block, index }))
        .filter(
          (item): item is { block: Extract<BlogBlock, { type: "paragraph" }>; index: number } =>
            item.block.type === "paragraph",
        ),
    [draft.blocks],
  );

  const headingBlocks = useMemo(
    () =>
      draft.blocks
        .map((block, index) => ({ block, index }))
        .filter(
          (item): item is { block: Extract<BlogBlock, { type: "heading" }>; index: number } =>
            item.block.type === "heading",
        ),
    [draft.blocks],
  );

  const resetTools = () => {
    setExtLinkEn("");
    setExtLinkAr("");
    setExtUrl("https://");
    setExtParagraphId("");
    setIntLinkEn("");
    setIntLinkAr("");
    setIntHeadingId("");
    setIntParagraphId("");
    setImgSrc("");
    setImgAltEn("");
    setImgAltAr("");
    setImgCaptionEn("");
    setImgCaptionAr("");
    setCursorBlockId("");
  };

  const persist = (next: BlogPost[]) => {
    setRows(next);
    saveBlogPosts(next);
    const cmsRows: BlogContent[] = next.map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      content: post.excerpt,
      excerpt: post.excerpt,
      image: post.coverImage,
      coverImage: post.coverImage,
      coverAlt: post.coverAlt,
      date: post.publishedAt,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      status: post.status,
      author: post.author,
      category: post.category,
      blocks: post.blocks,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      focusKeyword: post.focusKeyword,
      tags: post.tags,
      featured: post.featured,
    }));
    void saveCmsBlogPosts(cmsRows);
  };

  const save = () => {
    if (!draft.titleEn.trim() || !draft.titleAr.trim() || !draft.slug.trim()) return;
    const now = new Date().toISOString();
    const title = emptyLocalized(draft.titleEn.trim(), draft.titleAr.trim());
    const excerpt = emptyLocalized(
      draft.excerptEn.trim(),
      draft.excerptAr.trim() || draft.excerptEn.trim(),
    );
    const tagsEn = draft.tagsEn
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const tagsAr = draft.tagsAr
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const tagCount = Math.max(tagsEn.length, tagsAr.length);
    const tags = Array.from({ length: tagCount }, (_, index) =>
      emptyLocalized(tagsEn[index] || tagsAr[index] || "", tagsAr[index] || tagsEn[index] || ""),
    );

    const categoryEn = draft.categoryEn.trim();
    const categoryAr = draft.categoryAr.trim();
    const category =
      categoryEn || categoryAr
        ? emptyLocalized(categoryEn || categoryAr, categoryAr || categoryEn)
        : undefined;

    const payload: Omit<BlogPost, "id" | "publishedAt"> & { publishedAt?: string } = {
      slug: slugify(draft.slug),
      title,
      excerpt,
      coverImage: draft.coverImage.trim() || gallery1,
      coverAlt: emptyLocalized(
        draft.coverAltEn.trim() || draft.titleEn.trim(),
        draft.coverAltAr.trim() || draft.titleAr.trim() || draft.titleEn.trim(),
      ),
      author: emptyLocalized(
        draft.authorEn.trim() || "lunayairmarina",
        draft.authorAr.trim() || draft.authorEn.trim() || "lunayairmarina",
      ),
      category,
      updatedAt: now,
      status: draft.status,
      featured: draft.featured,
      seoTitle: emptyLocalized(
        draft.seoTitleEn.trim() || draft.titleEn.trim(),
        draft.seoTitleAr.trim() || draft.titleAr.trim() || draft.titleEn.trim(),
      ),
      seoDescription: emptyLocalized(
        draft.seoDescriptionEn.trim() || draft.excerptEn.trim(),
        draft.seoDescriptionAr.trim() || draft.excerptAr.trim() || draft.excerptEn.trim(),
      ),
      focusKeyword: emptyLocalized(draft.focusKeywordEn.trim(), draft.focusKeywordAr.trim()),
      tags,
      blocks: draft.blocks,
    };

    if (editingId) {
      persist(
        rows.map((row) =>
          row.id === editingId
            ? {
                ...row,
                ...payload,
                publishedAt: row.publishedAt,
              }
            : row,
        ),
      );
    } else {
      persist([
        ...rows,
        {
          id: `b${Date.now()}`,
          publishedAt: now,
          ...payload,
        } as BlogPost,
      ]);
    }

    setOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    resetTools();
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    resetTools();
    setOpen(true);
  };

  const openEdit = (row: BlogPost) => {
    setEditingId(row.id);
    setDraft({
      titleEn: tx(row.title, "en"),
      titleAr: tx(row.title, "ar"),
      slug: row.slug,
      excerptEn: tx(row.excerpt, "en"),
      excerptAr: tx(row.excerpt, "ar"),
      coverImage: row.coverImage,
      coverAltEn: tx(row.coverAlt, "en"),
      coverAltAr: tx(row.coverAlt, "ar"),
      authorEn: tx(row.author, "en"),
      authorAr: tx(row.author, "ar"),
      categoryEn: tx(row.category, "en"),
      categoryAr: tx(row.category, "ar"),
      status: row.status,
      featured: Boolean(row.featured),
      seoTitleEn: tx(row.seoTitle, "en"),
      seoTitleAr: tx(row.seoTitle, "ar"),
      seoDescriptionEn: tx(row.seoDescription, "en"),
      seoDescriptionAr: tx(row.seoDescription, "ar"),
      focusKeywordEn: tx(row.focusKeyword, "en"),
      focusKeywordAr: tx(row.focusKeyword, "ar"),
      tagsEn: row.tags.map((tag) => tx(tag, "en")).join(", "),
      tagsAr: row.tags.map((tag) => tx(tag, "ar")).join(", "),
      blocks: row.blocks,
    });
    resetTools();
    setOpen(true);
  };

  const updateBlock = (id: string, patch: Partial<BlogBlock>) => {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === id ? ({ ...block, ...patch } as BlogBlock) : block,
      ),
    }));
  };

  const addBlock = (type: BlogBlock["type"]) => {
    const id = newBlockId();
    let block: BlogBlock;
    if (type === "heading") block = { id, type, level: 2, text: emptyLocalized() };
    else if (type === "image")
      block = { id, type, src: gallery1, alt: emptyLocalized(), caption: emptyLocalized() };
    else if (type === "quote") block = { id, type, text: emptyLocalized() };
    else block = { id, type: "paragraph", spans: [{ type: "text", text: emptyLocalized() }] };
    setDraft((current) => ({ ...current, blocks: [...current.blocks, block] }));
  };

  const applyLinkToParagraph = (
    paragraphId: string,
    keywordEn: string,
    keywordAr: string,
    href: string,
  ) => {
    const target = draft.blocks.find(
      (block) => block.id === paragraphId && block.type === "paragraph",
    );
    if (!target || target.type !== "paragraph") return;
    const spans = wrapKeywordInParagraph(
      target.spans,
      keywordEn.trim(),
      keywordAr.trim(),
      href.trim(),
    );
    if (!spans) return;
    updateBlock(paragraphId, { spans });
  };

  const insertExternalLink = () => {
    const paragraphId = extParagraphId || paragraphBlocks[0]?.block.id;
    if (!paragraphId) return;
    applyLinkToParagraph(paragraphId, extLinkEn, extLinkAr, extUrl);
  };

  const insertInternalLink = () => {
    const paragraphId = intParagraphId || paragraphBlocks[0]?.block.id;
    const headingId = intHeadingId || headingBlocks[0]?.block.id;
    if (!paragraphId || !headingId) return;
    applyLinkToParagraph(paragraphId, intLinkEn, intLinkAr, `#${headingId}`);
  };

  const buildImageBlock = (): BlogBlock | null => {
    const src = imgSrc.trim();
    if (!src) return null;
    return {
      id: newBlockId(),
      type: "image",
      src,
      alt: emptyLocalized(imgAltEn.trim(), imgAltAr.trim() || imgAltEn.trim()),
      caption: emptyLocalized(imgCaptionEn.trim(), imgCaptionAr.trim() || imgCaptionEn.trim()),
    };
  };

  const clearImageTool = () => {
    setImgSrc("");
    setImgAltEn("");
    setImgAltAr("");
    setImgCaptionEn("");
    setImgCaptionAr("");
  };

  const insertImageAt = (where: "cursor" | "end") => {
    const block = buildImageBlock();
    if (!block) return;
    setDraft((current) => {
      if (where === "end" || !cursorBlockId) {
        return { ...current, blocks: [...current.blocks, block] };
      }
      const index = current.blocks.findIndex((item) => item.id === cursorBlockId);
      if (index < 0) return { ...current, blocks: [...current.blocks, block] };
      const next = [...current.blocks];
      next.splice(index + 1, 0, block);
      return { ...current, blocks: next };
    });
    clearImageTool();
  };

  const columns: Column<BlogPost>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("admin.blog.postTitle"),
        render: (row) => (
          <div>
            <p className="font-medium text-navy">{tx(row.title, language)}</p>
            <p className="text-xs text-muted-foreground">/blog/{row.slug}</p>
          </div>
        ),
      },
      {
        key: "keyword",
        header: t("admin.blog.focusKeyword"),
        render: (row) => (
          <span className="text-navy/80">{tx(row.focusKeyword, language) || "—"}</span>
        ),
      },
      {
        key: "status",
        header: t("admin.table.status"),
        render: (row) => (
          <StatusBadge
            label={row.status === "published" ? t("admin.status.active") : t("admin.status.draft")}
            tone={row.status === "published" ? "active" : "draft"}
          />
        ),
      },
    ],
    [t, language],
  );

  const paragraphOptions = (value: string, onChange: (id: string) => void) => (
    <label className="flex flex-col gap-2">
      <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
        {t("admin.blog.activeParagraph")}
      </span>
      <select
        value={value || paragraphBlocks[0]?.block.id || ""}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
        disabled={paragraphBlocks.length === 0}
      >
        {paragraphBlocks.length === 0 ? (
          <option value="">{t("admin.blog.addParagraph")}</option>
        ) : (
          paragraphBlocks.map(({ block, index }, n) => (
            <option key={block.id} value={block.id}>
              {t("admin.blog.paragraphN")} {n + 1}
              {paragraphText(block.spans, "en").trim()
                ? ` — ${paragraphText(block.spans, "en").slice(0, 40)}`
                : ` (#${index + 1})`}
            </option>
          ))
        )}
      </select>
    </label>
  );

  return (
    <AdminLayout title={t("admin.nav.blog")}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("admin.blog.subtitle")}</p>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90 sm:w-auto"
        >
          <Plus className="size-4" strokeWidth={1.5} />
          {t("admin.blog.add")}
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
              onClick={() => persist(rows.filter((item) => item.id !== row.id))}
            />
          </>
        )}
      />

      <Modal
        open={open}
        title={editingId ? t("admin.blog.edit") : t("admin.blog.add")}
        onClose={() => setOpen(false)}
        onSubmit={save}
        size="lg"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <ModalField
            label={`${t("admin.blog.postTitle")} · ${t("admin.blog.langEn")}`}
            value={draft.titleEn}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                titleEn: value,
                slug: current.slug || slugify(value),
                seoTitleEn: current.seoTitleEn || value,
              }))
            }
          />
          <ModalField
            label={`${t("admin.blog.postTitle")} · ${t("admin.blog.langAr")}`}
            value={draft.titleAr}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                titleAr: value,
                seoTitleAr: current.seoTitleAr || value,
              }))
            }
          />
        </div>
        <div>
          <ModalField
            label={t("admin.blog.slug")}
            value={draft.slug}
            onChange={(value) => setDraft({ ...draft, slug: slugify(value) })}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.blog.seoSlugHint")}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <ModalField
            textarea
            label={`${t("admin.blog.excerpt")} · ${t("admin.blog.langEn")}`}
            value={draft.excerptEn}
            onChange={(value) => setDraft({ ...draft, excerptEn: value })}
          />
          <ModalField
            textarea
            label={`${t("admin.blog.excerpt")} · ${t("admin.blog.langAr")}`}
            value={draft.excerptAr}
            onChange={(value) => setDraft({ ...draft, excerptAr: value })}
          />
        </div>

        {/* Content blocks */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
              {t("admin.blog.contentBlocks")}
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["paragraph", t("admin.blog.addParagraph")],
                  ["heading", t("admin.blog.addHeading")],
                  ["image", t("admin.blog.addImage")],
                  ["quote", t("admin.blog.addQuote")],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type)}
                  className="rounded-md border border-navy/10 px-3 py-1.5 text-[0.65rem] tracking-[0.12em] text-navy uppercase hover:border-navy/25"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("admin.blog.contentHint")}</p>

          <div className="mt-4 space-y-4">
            {draft.blocks.map((block, index) => (
              <div
                key={block.id}
                role="button"
                tabIndex={0}
                onClick={() => setCursorBlockId(block.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setCursorBlockId(block.id);
                }}
                className={cn(
                  "rounded-md border bg-sand p-4 text-start transition",
                  cursorBlockId === block.id
                    ? "border-gold ring-2 ring-gold/25"
                    : "border-navy/10 hover:border-navy/25",
                )}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-[0.65rem] tracking-[0.16em] text-gold uppercase">
                    {block.type} #{index + 1}
                    {cursorBlockId === block.id ? ` · ${t("admin.blog.selectedBlock")}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!window.confirm(t("admin.actions.confirmDelete"))) return;
                      setDraft((current) => ({
                        ...current,
                        blocks: current.blocks.filter((item) => item.id !== block.id),
                      }));
                      setCursorBlockId((current) => (current === block.id ? "" : current));
                    }}
                    className="text-xs text-destructive"
                  >
                    {t("admin.actions.delete")}
                  </button>
                </div>

                {block.type === "paragraph" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <textarea
                      rows={3}
                      value={paragraphText(block.spans, "en")}
                      onChange={(event) =>
                        updateBlock(block.id, {
                          spans: setParagraphLanguage(block.spans, "en", event.target.value),
                        })
                      }
                      className="w-full resize-none rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      placeholder={`${t("admin.blog.paragraphPlaceholder")} · ${t("admin.blog.langEn")}`}
                    />
                    <textarea
                      rows={3}
                      value={paragraphText(block.spans, "ar")}
                      onChange={(event) =>
                        updateBlock(block.id, {
                          spans: setParagraphLanguage(block.spans, "ar", event.target.value),
                        })
                      }
                      className="w-full resize-none rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      placeholder={`${t("admin.blog.paragraphPlaceholder")} · ${t("admin.blog.langAr")}`}
                      dir="rtl"
                    />
                  </div>
                ) : null}

                {block.type === "heading" ? (
                  <div className="grid gap-3">
                    <select
                      value={block.level}
                      onChange={(event) =>
                        updateBlock(block.id, { level: Number(event.target.value) as 2 | 3 })
                      }
                      className="rounded-md border border-navy/10 px-3 py-2 text-sm sm:max-w-[7rem]"
                    >
                      <option value={2}>H2</option>
                      <option value={3}>H3</option>
                    </select>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={tx(block.text, "en")}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            text: { en: event.target.value, ar: tx(block.text, "ar") },
                          })
                        }
                        placeholder={`${t("admin.blog.addHeading")} · ${t("admin.blog.langEn")}`}
                        className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      />
                      <input
                        value={tx(block.text, "ar")}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            text: { en: tx(block.text, "en"), ar: event.target.value },
                          })
                        }
                        placeholder={`${t("admin.blog.addHeading")} · ${t("admin.blog.langAr")}`}
                        dir="rtl"
                        className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      />
                    </div>
                  </div>
                ) : null}

                {block.type === "image" ? (
                  <div className="grid gap-3">
                    <MediaUploader
                      value={block.src}
                      pathPrefix="images/blog"
                      allowGallery
                      onChange={(url, meta) =>
                        updateBlock(block.id, {
                          src: url,
                          alt: meta?.caption
                            ? {
                                en: meta.caption.en || tx(block.alt, "en"),
                                ar: meta.caption.ar || tx(block.alt, "ar"),
                              }
                            : block.alt,
                          caption: meta?.caption
                            ? {
                                en: meta.caption.en || tx(block.caption, "en"),
                                ar: meta.caption.ar || tx(block.caption, "ar"),
                              }
                            : block.caption,
                        })
                      }
                    />
                    <input
                      value={block.src}
                      onChange={(event) => updateBlock(block.id, { src: event.target.value })}
                      placeholder={t("admin.blog.imageUrl")}
                      className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={tx(block.alt, "en")}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            alt: { en: event.target.value, ar: tx(block.alt, "ar") },
                          })
                        }
                        placeholder={`${t("admin.blog.imageAlt")} · ${t("admin.blog.langEn")}`}
                        className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      />
                      <input
                        value={tx(block.alt, "ar")}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            alt: { en: tx(block.alt, "en"), ar: event.target.value },
                          })
                        }
                        placeholder={`${t("admin.blog.imageAlt")} · ${t("admin.blog.langAr")}`}
                        dir="rtl"
                        className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      />
                      <input
                        value={tx(block.caption, "en")}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            caption: { en: event.target.value, ar: tx(block.caption, "ar") },
                          })
                        }
                        placeholder={`${t("admin.blog.imageCaption")} · ${t("admin.blog.langEn")}`}
                        className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      />
                      <input
                        value={tx(block.caption, "ar")}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            caption: { en: tx(block.caption, "en"), ar: event.target.value },
                          })
                        }
                        placeholder={`${t("admin.blog.imageCaption")} · ${t("admin.blog.langAr")}`}
                        dir="rtl"
                        className="rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      />
                    </div>
                  </div>
                ) : null}

                {block.type === "quote" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <textarea
                      rows={2}
                      value={tx(block.text, "en")}
                      onChange={(event) =>
                        updateBlock(block.id, {
                          text: { en: event.target.value, ar: tx(block.text, "ar") },
                        })
                      }
                      className="w-full resize-none rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      placeholder={`${t("admin.blog.addQuote")} · ${t("admin.blog.langEn")}`}
                    />
                    <textarea
                      rows={2}
                      value={tx(block.text, "ar")}
                      onChange={(event) =>
                        updateBlock(block.id, {
                          text: { en: tx(block.text, "en"), ar: event.target.value },
                        })
                      }
                      dir="rtl"
                      className="w-full resize-none rounded-md border border-navy/10 px-3 py-2 text-sm outline-none focus:border-navy/30"
                      placeholder={`${t("admin.blog.addQuote")} · ${t("admin.blog.langAr")}`}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Tool panels */}
        <div className="space-y-4">
          {/* External links */}
          <div className="rounded-xl border border-navy/10 bg-sand p-4">
            <div className="flex items-start gap-2">
              <Link className="mt-0.5 size-4 shrink-0 text-gold" strokeWidth={1.5} />
              <div>
                <p className="text-[0.65rem] tracking-[0.2em] text-navy uppercase">
                  {t("admin.blog.toolsExternalTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("admin.blog.toolsExternalHint")}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {t("admin.blog.linkText")} (EN)
                </span>
                <input
                  value={extLinkEn}
                  onChange={(event) => setExtLinkEn(event.target.value)}
                  placeholder={t("admin.blog.linkTextPlaceholder")}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {t("admin.blog.linkText")} (AR)
                </span>
                <input
                  value={extLinkAr}
                  onChange={(event) => setExtLinkAr(event.target.value)}
                  placeholder={t("admin.blog.linkTextPlaceholder")}
                  dir="rtl"
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-2 sm:col-span-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {t("admin.blog.linkUrl")}
                </span>
                <input
                  value={extUrl}
                  onChange={(event) => setExtUrl(event.target.value)}
                  placeholder={t("admin.blog.linkUrlPlaceholder")}
                  className={fieldClass}
                />
              </label>
              {paragraphOptions(extParagraphId, setExtParagraphId)}
            </div>
            <button
              type="button"
              onClick={insertExternalLink}
              disabled={
                (!extLinkEn.trim() && !extLinkAr.trim()) ||
                !extUrl.trim() ||
                paragraphBlocks.length === 0
              }
              className={cn(toolBtnClass, "mt-4")}
            >
              <Link className="size-3.5" strokeWidth={1.5} />
              {t("admin.blog.insertExternalLink")}
            </button>
          </div>

          {/* Internal section links */}
          <div className="rounded-xl border border-navy/10 bg-sand p-4">
            <div className="flex items-start gap-2">
              <ListPlus className="mt-0.5 size-4 shrink-0 text-gold" strokeWidth={1.5} />
              <div>
                <p className="text-[0.65rem] tracking-[0.2em] text-navy uppercase">
                  {t("admin.blog.toolsInternalTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("admin.blog.toolsInternalHint")}
                </p>
              </div>
            </div>
            {headingBlocks.length === 0 ? (
              <div className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-xs text-navy/80">
                {t("admin.blog.toolsInternalEmpty")}
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                      {t("admin.blog.linkText")} (EN)
                    </span>
                    <input
                      value={intLinkEn}
                      onChange={(event) => setIntLinkEn(event.target.value)}
                      placeholder={t("admin.blog.linkTextPlaceholder")}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                      {t("admin.blog.linkText")} (AR)
                    </span>
                    <input
                      value={intLinkAr}
                      onChange={(event) => setIntLinkAr(event.target.value)}
                      placeholder={t("admin.blog.linkTextPlaceholder")}
                      dir="rtl"
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-2 sm:col-span-2">
                    <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                      {t("admin.blog.sectionTarget")}
                    </span>
                    <select
                      value={intHeadingId || headingBlocks[0]?.block.id || ""}
                      onChange={(event) => setIntHeadingId(event.target.value)}
                      className={selectClass}
                    >
                      {headingBlocks.map(({ block }) => (
                        <option key={block.id} value={block.id}>
                          {tx(block.text, "en") || "(untitled)"} — H{block.level}
                        </option>
                      ))}
                    </select>
                  </label>
                  {paragraphOptions(intParagraphId, setIntParagraphId)}
                </div>
                <button
                  type="button"
                  onClick={insertInternalLink}
                  disabled={
                    (!intLinkEn.trim() && !intLinkAr.trim()) || paragraphBlocks.length === 0
                  }
                  className={cn(toolBtnClass, "mt-4")}
                >
                  <ListPlus className="size-3.5" strokeWidth={1.5} />
                  {t("admin.blog.insertInternalLink")}
                </button>
              </>
            )}
          </div>

          {/* Images inside article */}
          <div className="rounded-xl border border-navy/10 bg-sand p-4">
            <div className="flex items-start gap-2">
              <ImageIcon className="mt-0.5 size-4 shrink-0 text-gold" strokeWidth={1.5} />
              <div>
                <p className="text-[0.65rem] tracking-[0.2em] text-navy uppercase">
                  {t("admin.blog.toolsImagesTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("admin.blog.toolsImagesHint")}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <MediaUploader
                value={imgSrc}
                pathPrefix="images/blog"
                allowGallery
                onChange={(url, meta) => {
                  setImgSrc(url);
                  if (meta?.caption) {
                    setImgAltEn((current) => meta.caption?.en || current);
                    setImgAltAr((current) => meta.caption?.ar || current);
                    setImgCaptionEn((current) => meta.caption?.en || current);
                    setImgCaptionAr((current) => meta.caption?.ar || current);
                  }
                }}
              />
              <label className="flex flex-col gap-2">
                <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                  {t("admin.blog.imageUrl")}
                </span>
                <input
                  value={imgSrc}
                  onChange={(event) => setImgSrc(event.target.value)}
                  placeholder={t("admin.blog.imageUrl")}
                  className={fieldClass}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.blog.imageAlt")} (EN)
                  </span>
                  <input
                    value={imgAltEn}
                    onChange={(event) => setImgAltEn(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.blog.imageAlt")} (AR)
                  </span>
                  <input
                    value={imgAltAr}
                    onChange={(event) => setImgAltAr(event.target.value)}
                    dir="rtl"
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.blog.imageCaption")} (EN)
                  </span>
                  <input
                    value={imgCaptionEn}
                    onChange={(event) => setImgCaptionEn(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
                    {t("admin.blog.imageCaption")} (AR)
                  </span>
                  <input
                    value={imgCaptionAr}
                    onChange={(event) => setImgCaptionAr(event.target.value)}
                    dir="rtl"
                    className={fieldClass}
                  />
                </label>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("admin.blog.cursorHint")}
              {cursorBlockId
                ? ` — ${t("admin.blog.selectedBlock")}: ${
                    draft.blocks.findIndex((item) => item.id === cursorBlockId) + 1
                  }`
                : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => insertImageAt("cursor")}
                disabled={!imgSrc.trim() || !cursorBlockId}
                className={toolBtnClass}
              >
                <ImageIcon className="size-3.5" strokeWidth={1.5} />
                {t("admin.blog.insertImageCursor")}
              </button>
              <button
                type="button"
                onClick={() => insertImageAt("end")}
                disabled={!imgSrc.trim()}
                className={toolBtnClass}
              >
                <ImageIcon className="size-3.5" strokeWidth={1.5} />
                {t("admin.blog.insertImageEnd")}
              </button>
            </div>
          </div>
        </div>

        {/* Category, author, tags, cover, status */}
        <div className="rounded-xl border border-navy/10 p-4">
          <p className="text-[0.65rem] tracking-[0.2em] text-navy uppercase">
            {t("admin.blog.metaSection")}
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <ModalField
              label={`${t("admin.blog.category")} · ${t("admin.blog.langEn")}`}
              value={draft.categoryEn}
              onChange={(value) => setDraft({ ...draft, categoryEn: value })}
              placeholder={t("admin.blog.categoryPlaceholder")}
            />
            <ModalField
              label={`${t("admin.blog.category")} · ${t("admin.blog.langAr")}`}
              value={draft.categoryAr}
              onChange={(value) => setDraft({ ...draft, categoryAr: value })}
              placeholder={t("admin.blog.categoryPlaceholder")}
            />
            <ModalField
              label={`${t("admin.blog.author")} · ${t("admin.blog.langEn")}`}
              value={draft.authorEn}
              onChange={(value) => setDraft({ ...draft, authorEn: value })}
            />
            <ModalField
              label={`${t("admin.blog.author")} · ${t("admin.blog.langAr")}`}
              value={draft.authorAr}
              onChange={(value) => setDraft({ ...draft, authorAr: value })}
            />
            <ModalField
              label={`${t("admin.blog.tags")} · ${t("admin.blog.langEn")}`}
              value={draft.tagsEn}
              onChange={(value) => setDraft({ ...draft, tagsEn: value })}
            />
            <ModalField
              label={`${t("admin.blog.tags")} · ${t("admin.blog.langAr")}`}
              value={draft.tagsAr}
              onChange={(value) => setDraft({ ...draft, tagsAr: value })}
            />
          </div>
        </div>

        {/* Cover */}
        <div className="rounded-xl border border-navy/10 p-4">
          <MediaUploader
            label={t("admin.blog.coverImage")}
            value={draft.coverImage}
            pathPrefix="images/blog"
            allowGallery
            onChange={(url, meta) =>
              setDraft({
                ...draft,
                coverImage: url,
                coverAltEn: meta?.caption?.en || draft.coverAltEn,
                coverAltAr: meta?.caption?.ar || draft.coverAltAr,
              })
            }
          />
          <div className="mt-4">
            <ModalField
              label={t("admin.blog.coverUrl")}
              value={draft.coverImage}
              onChange={(value) => setDraft({ ...draft, coverImage: value })}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.blog.coverUrlHint")}</p>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <ModalField
              label={`${t("admin.blog.coverAlt")} · ${t("admin.blog.langEn")}`}
              value={draft.coverAltEn}
              onChange={(value) => setDraft({ ...draft, coverAltEn: value })}
            />
            <ModalField
              label={`${t("admin.blog.coverAlt")} · ${t("admin.blog.langAr")}`}
              value={draft.coverAltAr}
              onChange={(value) => setDraft({ ...draft, coverAltAr: value })}
            />
          </div>
        </div>

        {/* Trending + status */}
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-md border border-navy/10 bg-sand px-4 py-3">
            <input
              type="checkbox"
              checked={draft.featured}
              onChange={(event) => setDraft({ ...draft, featured: event.target.checked })}
              className="size-4 accent-gold"
            />
            <span className="text-sm text-navy">{t("admin.blog.trending")}</span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
              {t("admin.table.status")}
            </span>
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as "published" | "draft" })
              }
              className={selectClass}
            >
              <option value="draft">{t("admin.status.draft")}</option>
              <option value="published">{t("admin.status.active")}</option>
            </select>
          </label>
        </div>

        {/* SEO */}
        <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
          <p className="text-[0.65rem] tracking-[0.2em] text-gold uppercase">
            {t("admin.blog.seoBox")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{t("admin.blog.seoLead")}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <ModalField
                label={`${t("admin.blog.seoTitle")} · ${t("admin.blog.langEn")}`}
                value={draft.seoTitleEn}
                onChange={(value) => setDraft({ ...draft, seoTitleEn: value })}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.blog.seoTitleHint")}</p>
            </div>
            <div>
              <ModalField
                label={`${t("admin.blog.seoTitle")} · ${t("admin.blog.langAr")}`}
                value={draft.seoTitleAr}
                onChange={(value) => setDraft({ ...draft, seoTitleAr: value })}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.blog.seoTitleHint")}</p>
            </div>
            <div>
              <ModalField
                textarea
                label={`${t("admin.blog.seoDescription")} · ${t("admin.blog.langEn")}`}
                value={draft.seoDescriptionEn}
                onChange={(value) => setDraft({ ...draft, seoDescriptionEn: value })}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.blog.seoDescHint")}</p>
            </div>
            <div>
              <ModalField
                textarea
                label={`${t("admin.blog.seoDescription")} · ${t("admin.blog.langAr")}`}
                value={draft.seoDescriptionAr}
                onChange={(value) => setDraft({ ...draft, seoDescriptionAr: value })}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.blog.seoDescHint")}</p>
            </div>
            <ModalField
              label={`${t("admin.blog.focusKeyword")} · ${t("admin.blog.langEn")}`}
              value={draft.focusKeywordEn}
              onChange={(value) => setDraft({ ...draft, focusKeywordEn: value })}
            />
            <ModalField
              label={`${t("admin.blog.focusKeyword")} · ${t("admin.blog.langAr")}`}
              value={draft.focusKeywordAr}
              onChange={(value) => setDraft({ ...draft, focusKeywordAr: value })}
            />
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
