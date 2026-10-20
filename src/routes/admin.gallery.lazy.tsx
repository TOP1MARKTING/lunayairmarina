import { useEffect, useMemo, useRef, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Trash2, Upload, Pencil } from "lucide-react";
import { motion } from "motion/react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Modal, ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { galleryImages } from "@/data/mock";
import { CMS_UPDATED_EVENT, loadCmsStore } from "@/lib/cms-store";
import {
  describeSaveResult,
  fetchGalleryFromFirebase,
  isGalleryManaged,
  markGalleryManaged,
  saveGallery,
  MediaUploadError,
  uploadMediaFile,
} from "@/services/adminCmsService";
import type { GalleryContent } from "@/types/content";
import { isMediaRef, resolveMediaSrc } from "@/lib/media-refs";
import { healGallerySrc, isFragileGallerySrc, pickGallerySrc } from "@/lib/gallery-src";
import { asLocalized, pairLocalized } from "@/lib/localized";

export const Route = createLazyFileRoute("/admin/gallery")({
  component: AdminGalleryPage,
});

function seedFromMocks(): GalleryContent[] {
  return galleryImages.map((item, index) => ({
    id: item.id,
    src: healGallerySrc(item.id, item.src),
    caption: item.caption,
    span: item.span,
    order: index + 1,
  }));
}

function normalizeItems(list: GalleryContent[]): GalleryContent[] {
  return list.map((item, index) => ({
    ...item,
    src: healGallerySrc(item.id, item.src),
    order: item.order ?? index + 1,
  }));
}

function AdminGalleryPage() {
  const { t, language } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<GalleryContent[]>(() => {
    const cms = loadCmsStore();
    if (cms.gallery.length) return normalizeItems(cms.gallery);
    if (isGalleryManaged()) return [];
    return seedFromMocks();
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captionEn, setCaptionEn] = useState("");
  const [captionAr, setCaptionAr] = useState("");
  const healedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const remote = await fetchGalleryFromFirebase();
        if (cancelled) return;
        if (remote.length) {
          const next = normalizeItems(remote);
          setItems(next);
          // Rewrite fragile Vite `/assets/hash` paths to stable `/images/...` once.
          const needsHeal = remote.some(
            (item) =>
              isFragileGallerySrc(item.src) && healGallerySrc(item.id, item.src) !== item.src,
          );
          if (needsHeal && !healedOnce.current) {
            healedOnce.current = true;
            void saveGallery(next);
          }
          return;
        }
        // Firebase returned an empty gallery — respect deletions; do not reseed mocks.
        if (isGalleryManaged()) {
          setItems([]);
          return;
        }
        const cms = loadCmsStore();
        if (cms.gallery.length) {
          setItems(normalizeItems(cms.gallery));
          return;
        }
        setItems(seedFromMocks());
      } catch {
        // Keep current list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onCms = () => {
      const cms = loadCmsStore();
      if (cms.gallery.length) setItems(normalizeItems(cms.gallery));
    };
    window.addEventListener(CMS_UPDATED_EVENT, onCms);
    return () => window.removeEventListener(CMS_UPDATED_EVENT, onCms);
  }, []);

  const itemsKey = items.map((item) => `${item.id}:${item.src}`).join("|");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        items.map(async (item) => {
          const fallback = pickGallerySrc(item.src, item.id);
          if (isMediaRef(item.src)) {
            next[item.id] = await resolveMediaSrc(item.src, fallback);
          } else {
            next[item.id] = fallback;
          }
        }),
      );
      if (!cancelled) setResolved(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const persist = async (next: GalleryContent[]) => {
    markGalleryManaged();
    const normalized = normalizeItems(next);
    setItems(normalized);
    const result = await saveGallery(normalized);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const url = await uploadMediaFile(file, {
        pathPrefix: "images/gallery",
      });
      const item: GalleryContent = {
        id: `g${Date.now()}`,
        src: url,
        caption: { en: file.name.replace(/\.[^.]+$/, ""), ar: file.name.replace(/\.[^.]+$/, "") },
        span: "normal",
        order: items.length + 1,
      };
      await persist([...items, item]);
      setStatus(t("admin.cms.uploadSuccess"));
    } catch (err) {
      const code = err instanceof MediaUploadError ? err.code : "UPLOAD_FAILED";
      if (code === "INVALID_TYPE") setStatus(t("admin.cms.uploadInvalidType"));
      else if (code === "FILE_TOO_LARGE") setStatus(t("admin.cms.uploadTooLarge"));
      else if (code === "TOO_LARGE_AFTER_COMPRESS") setStatus(t("admin.cms.uploadCompressFailed"));
      else setStatus(t("admin.cms.uploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const previewSrc = useMemo(
    () => (item: GalleryContent) => resolved[item.id] || pickGallerySrc(item.src, item.id),
    [resolved],
  );

  return (
    <AdminLayout title={t("admin.nav.gallery")}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {status ? <span className="text-xs text-navy/55">{status}</span> : <span />}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90 disabled:opacity-60 sm:w-auto"
        >
          <Upload className="size-4" strokeWidth={1.5} />
          {busy ? t("common.loading") : t("admin.actions.upload")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(event) => void onUpload(event.target.files?.[0])}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((image, index) => {
          const src = previewSrc(image);
          return (
            <motion.figure
              key={image.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.4 }}
              className="group relative overflow-hidden rounded-2xl border border-navy/8 bg-white shadow-sm"
            >
              {src ? (
                <img
                  src={src}
                  alt={image.caption[language]}
                  loading="lazy"
                  className="aspect-4/3 w-full bg-sand object-cover"
                />
              ) : (
                <div className="flex aspect-4/3 w-full items-center justify-center bg-sand px-4 text-center text-xs text-navy/40">
                  {image.caption[language]}
                </div>
              )}
              <figcaption className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-navy/70">
                <span className="truncate">{image.caption[language]}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label={t("admin.actions.edit")}
                    onClick={() => {
                      const caption = asLocalized(image.caption);
                      setEditingId(image.id);
                      setCaptionEn(caption.en);
                      setCaptionAr(caption.ar);
                    }}
                    className="text-navy/45 transition-colors hover:text-navy"
                  >
                    <Pencil className="size-4" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("admin.actions.delete")}
                    onClick={() => {
                      if (!window.confirm(t("admin.actions.confirmDelete"))) return;
                      void persist(items.filter((item) => item.id !== image.id));
                    }}
                    className="text-red-500 transition-colors hover:text-red-600"
                  >
                    <Trash2 className="size-4" strokeWidth={1.5} />
                  </button>
                </span>
              </figcaption>
            </motion.figure>
          );
        })}
      </div>

      <Modal
        open={Boolean(editingId)}
        title={t("admin.actions.edit")}
        onClose={() => setEditingId(null)}
        onSubmit={() => {
          if (!editingId) return;
          const caption = pairLocalized(captionEn, captionAr);
          void persist(items.map((item) => (item.id === editingId ? { ...item, caption } : item)));
          setEditingId(null);
        }}
      >
        <ModalField
          label={`${t("admin.blog.imageCaption")} (EN)`}
          value={captionEn}
          onChange={setCaptionEn}
        />
        <ModalField
          label={`${t("admin.blog.imageCaption")} (AR)`}
          value={captionAr}
          onChange={setCaptionAr}
        />
      </Modal>
    </AdminLayout>
  );
}
