/**
 * Central media helpers + filename aliases for CMS/legacy paths.
 * Physical files live under src/assets/{brand,hero,about,headers,gallery,fleet,admin}/
 */
import heroMain from "@/assets/hero/hero-main.webp";
import aboutMarina from "@/assets/about/yacht_side_transom_landscape.png";
import adminLoginBg from "@/assets/admin/admin-login-bg.webp";
import fleet01 from "@/assets/fleet/fleet-01.jpg";
import fleet02 from "@/assets/fleet/fleet-02.jpg";
import fleet03 from "@/assets/fleet/fleet-03.jpg";
import gallery01 from "@/assets/gallery/gallery-01-marina.jpg";
import gallery02 from "@/assets/gallery/gallery-02-deck.jpg";
import gallery03 from "@/assets/gallery/gallery-03-lounge.jpg";
import gallery04 from "@/assets/gallery/gallery-04-sunset.jpg";
import gallery05 from "@/assets/gallery/gallery-05-arrival.jpg";
import gallery06 from "@/assets/gallery/gallery-06-crew.jpg";
import gallery07 from "@/assets/gallery/gallery-07-harbor.jpg";
import gallery08 from "@/assets/gallery/gallery-08-bridge.jpg";
import headerAbout from "@/assets/headers/header-about.webp";
import headerBlog from "@/assets/headers/header-blog.webp";
import headerContact from "@/assets/headers/header-contact.webp";
import headerServices from "@/assets/headers/header-services.webp";
import headerAdvertising from "@/assets/headers/header-advertising.webp";
import logo from "@/assets/brand/logo.png";
import serviceYachtMgmt from "@/assets/services/service-yacht-management.jpg";
import serviceAgency from "@/assets/services/service-yacht-agency.jpg";
import serviceMarina from "@/assets/services/service-marina.jpg";
import serviceCrew from "@/assets/services/service-crew.jpg";
import { isMediaRef, resolveMediaSrcSync } from "@/lib/media-refs";

/** New canonical filenames */
const ASSET_BY_FILENAME: Record<string, string> = {
  "hero-main.jpg": heroMain,
  "hero-main.webp": heroMain,
  "about-marina.jpg": aboutMarina,
  "about-marina.webp": aboutMarina,
  "yacht_lunaiyar.png": aboutMarina,
  "yacht_side_transom_landscape.png": aboutMarina,
  "fleet-01.jpg": fleet01,
  "fleet-02.jpg": fleet02,
  "fleet-03.jpg": fleet03,
  "gallery-01-marina.jpg": gallery01,
  "gallery-02-deck.jpg": gallery02,
  "gallery-03-lounge.jpg": gallery03,
  "gallery-04-sunset.jpg": gallery04,
  "gallery-05-arrival.jpg": gallery05,
  "gallery-06-crew.jpg": gallery06,
  "gallery-07-harbor.jpg": gallery07,
  "gallery-08-bridge.jpg": gallery08,
  "service-yacht-management.jpg": serviceYachtMgmt,
  "service-yacht-agency.jpg": serviceAgency,
  "service-marina.jpg": serviceMarina,
  "service-crew.jpg": serviceCrew,
  "logo.png": logo,

  // Legacy aliases (CMS / older Firestore paths)
  "hero-yacht.jpg": heroMain,
  "yacht-1.jpg": fleet01,
  "yacht-2.jpg": fleet02,
  "yacht-3.jpg": fleet03,
  "gallery-1.jpg": gallery01,
  "gallery-2.jpg": gallery02,
  "gallery-3.jpg": gallery03,
  "gallery-4.jpg": gallery04,
  "lunayairmarina.png": logo,
  "page-header-about.jpg": headerAbout,
  "page-header-blog.jpg": headerBlog,
  "page-header-contact.jpg": headerContact,
  "page-header-services.jpg": headerServices,
  "header-about.jpg": headerAbout,
  "header-blog.jpg": headerBlog,
  "header-contact.jpg": headerContact,
  "header-services.jpg": headerServices,
  "header-advertising.jpg": headerAdvertising,
  "header-about.webp": headerAbout,
  "header-blog.webp": headerBlog,
  "header-contact.webp": headerContact,
  "header-services.webp": headerServices,
  "header-advertising.webp": headerAdvertising,
  "admin-bg.jpg": adminLoginBg,
  "admin-login-bg.jpg": adminLoginBg,
  "admin-login-bg.webp": adminLoginBg,
};

/**
 * Vite emits `/assets/<name>-<hash>.<ext>` and the hash changes every build, so any
 * such URL persisted into the CMS 404s after the next deploy. Drop the hash so the
 * filename can be matched back to a bundled asset.
 */
function withoutBuildHash(fileName: string): string {
  return fileName.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/i, "$1");
}

function bundledAssetFor(fileName: string): string | undefined {
  return ASSET_BY_FILENAME[fileName] ?? ASSET_BY_FILENAME[withoutBuildHash(fileName)];
}

/**
 * Normalize CMS/Firestore media URLs.
 * Fixes legacy `/src/assets/...` paths and stale hashed build URLs that break in the browser.
 * Never returns a raw `media:` ref (invalid as img src) — uses memory cache or fallback.
 */
export function resolvePublicMediaSrc(
  src: string | undefined | null,
  fallback = gallery01,
): string {
  if (!src || !src.trim()) return fallback;
  const value = src.trim();

  if (isMediaRef(value)) {
    return resolveMediaSrcSync(value, fallback);
  }

  if (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    // Never rewrite permanent Firebase Storage CMS uploads.
    if (/firebasestorage\.googleapis\.com/i.test(value)) return value;
    // Prefer the branded yacht asset over legacy about-marina hosted URLs.
    if (/about-marina/i.test(value)) return aboutMarina;
    return value;
  }

  if (value.startsWith("/assets/")) {
    const assetName = value.split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";
    return bundledAssetFor(assetName) ?? value;
  }

  if (value.startsWith("/images/") || value.startsWith("/videos/")) {
    if (/about-marina|yacht_lunaiyar|yacht_side_transom/i.test(value)) return aboutMarina;
    // Prefer WebP siblings for known optimized folders (hero/headers/about).
    if (
      value.startsWith("/images/hero/") ||
      value.startsWith("/images/headers/") ||
      value.startsWith("/images/about/")
    ) {
      return value.replace(/\.jpe?g(\?.*)?$/i, ".webp$1");
    }
    return value;
  }

  const fileName = value.split(/[/\\]/).pop()?.split("?")[0]?.toLowerCase() ?? "";
  const bundled = fileName ? bundledAssetFor(fileName) : undefined;
  if (bundled) return bundled;

  if (value.includes("/src/assets/") || value.startsWith("src/assets/")) {
    return fallback;
  }

  return value;
}

export function isUsableBlogSlug(slug: string | undefined | null): boolean {
  if (!slug) return false;
  const trimmed = slug.trim();
  return trimmed.length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed);
}
