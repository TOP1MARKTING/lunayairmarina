import { useMemo, useState } from "react";
import { Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import { useOptionalSiteContent } from "@/providers/SiteContentProvider";
import { galleryImages } from "@/data/mock";
import { pickGallerySrc } from "@/lib/gallery-src";
import { ResolvedImage } from "@/components/shared/ResolvedImage";

interface GalleryPickerProps {
  value?: string;
  onSelect: (src: string, caption?: { en: string; ar: string }) => void;
  className?: string;
}

export function GalleryPicker({ value, onSelect, className }: GalleryPickerProps) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const site = useOptionalSiteContent();

  const items = useMemo(() => {
    const remote = site?.bundle?.gallery ?? [];
    const source =
      remote.length > 0
        ? remote.map((item) => {
            const local = galleryImages.find((g) => g.id === item.id);
            return {
              id: item.id,
              src: item.src,
              caption: local?.caption ?? item.caption,
            };
          })
        : galleryImages.map((item) => ({
            id: item.id,
            src: item.src,
            caption: item.caption,
          }));

    const seen = new Set<string>();
    return source.filter((item) => {
      const key = item.src.split("?")[0] ?? item.src;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [site?.bundle?.gallery]);

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-navy/10 bg-white px-4 py-2 text-xs tracking-[0.14em] text-navy uppercase transition hover:border-navy/25"
      >
        <Images className="size-3.5" strokeWidth={1.6} />
        {open ? t("admin.blog.hideGallery") : t("admin.blog.pickFromGallery")}
      </button>

      {open ? (
        <div className="rounded-xl border border-navy/10 bg-sand p-3">
          <p className="mb-3 text-[0.65rem] text-navy/50">{t("admin.blog.galleryPickHint")}</p>
          <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {items.map((item) => {
              const selected = value === item.src;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.caption[language]}
                  onClick={() => {
                    onSelect(item.src, item.caption);
                    setOpen(false);
                  }}
                  className={cn(
                    "aspect-square overflow-hidden rounded-lg border-2 transition",
                    selected
                      ? "border-gold ring-2 ring-gold/30"
                      : "border-transparent hover:border-navy/20",
                  )}
                >
                  <ResolvedImage
                    src={item.src}
                    fallback={pickGallerySrc(item.src, item.id)}
                    alt={item.caption[language]}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
