import { collection, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { getDb, getFirebaseStorage } from "@/lib/firebase";
import {
  CMS_BROADCAST_CHANNEL,
  CMS_UPDATED_EVENT,
  deepMergeCopy,
  diffCopyAgainstLocale,
  isCollectionManaged,
  loadCmsStore,
  markCollectionManaged,
  patchCmsStore,
  repairWrongLanguageCopy,
  type CmsMessage,
  type CmsStore,
  type FirebaseSyncStatus,
  type PageHeaderId,
  type SeoPageId,
  type SeoPageMeta,
} from "@/lib/cms-store";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";
import { clearContentCache } from "@/services/content";
import type {
  AboutContent,
  AdvertisementContent,
  BlogContent,
  FaqContent,
  GalleryContent,
  HomepageContent,
  ServiceContent,
  SiteSettings,
  TestimonialContent,
  TrustContent,
  WhyContent,
} from "@/types/content";
import { normalizeAdvertisementPackage, normalizeAdvertisementStatus } from "@/lib/advertisements";
import { companyInfo } from "@/data/mock";
import { healGallerySrc, isFragileGallerySrc } from "@/lib/gallery-src";
import { cacheMediaDataUrl, mediaRefId, toMediaRef } from "@/lib/media-refs";

export type SaveResult = { ok: true; sync: FirebaseSyncStatus } | { ok: false; error: string };

const STABLE_PAGE_HEADERS: Record<PageHeaderId, string> = {
  about: "/images/headers/header-about.webp",
  services: "/images/headers/header-services.webp",
  contact: "/images/headers/header-contact.webp",
  blog: "/images/headers/header-blog.webp",
  application: "/images/headers/header-about.webp",
  advertising: "/images/headers/header-advertising.webp",
};

function normalizePageHeaderUrl(pageId: PageHeaderId, imageUrl: string): string {
  const value = imageUrl.trim();
  if (!value) return STABLE_PAGE_HEADERS[pageId];
  if (
    value.startsWith("media:") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    /^https?:\/\//i.test(value)
  ) {
    return value;
  }
  if (value.startsWith("/images/headers/")) {
    return value.replace(/\.(jpe?g|png)(\?.*)?$/i, ".webp$2");
  }
  if (isFragileGallerySrc(value) || value.startsWith("/assets/")) {
    return STABLE_PAGE_HEADERS[pageId];
  }
  return value;
}

export function markGalleryManaged() {
  markCollectionManaged("gallery");
}

export function isGalleryManaged(): boolean {
  return isCollectionManaged("gallery");
}

export function describeSaveResult(
  result: SaveResult,
  labels: { synced: string; failed?: string; local?: string },
) {
  if (result.ok && result.sync === "synced") return labels.synced;
  return labels.failed || labels.local || "Save failed";
}

function notifySiteReload() {
  clearContentCache();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CMS_UPDATED_EVENT));
  try {
    const channel = new BroadcastChannel(CMS_BROADCAST_CHANNEL);
    channel.postMessage({ type: "cms-updated", at: Date.now() });
    channel.close();
  } catch {
    // Older browsers / restricted contexts
  }
  // Soft flag for AI knowledge re-ingest (Admin SDK runs sync later — never on every chat blindly).
  void setDoc(
    doc(getDb(), "knowledgeSync", "status"),
    {
      needsReingest: true,
      reason: "cms_content_updated",
      requestedAt: new Date().toISOString(),
    },
    { merge: true },
  ).catch(() => {
    // Best-effort; admin may lack rules until published.
  });
}

async function mirrorFullCmsStore() {
  const store = loadCmsStore();
  // Never mirror raw data-URL blobs into cms/v1 (hits the 1MB doc limit).
  const gallery = store.gallery.map((item) => ({
    ...item,
    src: item.src.startsWith("data:") ? "" : item.src,
  }));
  await setDoc(
    doc(getDb(), "cms", "v1"),
    {
      ...store,
      gallery,
      messages: store.messages.slice(0, 30),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

async function persistToFirebase(
  task: () => Promise<void>,
  patch: Partial<CmsStore>,
  onSuccess?: () => void,
): Promise<SaveResult> {
  try {
    await task();
    try {
      await mirrorFullCmsStore();
    } catch {
      // Collection write succeeded; full cms/v1 mirror is best-effort.
    }
    onSuccess?.();
    patchCmsStore({ ...patch, firebaseSync: "synced" });
    notifySiteReload();
    return { ok: true, sync: "synced" };
  } catch (error) {
    patchCmsStore({ firebaseSync: "error" });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "FIREBASE_SAVE_FAILED",
    };
  }
}


export async function saveSettings(settings: SiteSettings, logoUrl?: string): Promise<SaveResult> {
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "settings", "general"), settings, { merge: true });
  }, {
settings, logoUrl: logoUrl ?? loadCmsStore().logoUrl,
  });
}

export async function saveHomepage(homepage: HomepageContent): Promise<SaveResult> {
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "homepage", "main"), homepage, { merge: true });
  }, {
homepage,
  });
}

export async function saveAbout(about: AboutContent): Promise<SaveResult> {
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "about", "main"), about, { merge: true });
  }, {
about,
  });
}

export async function saveCopyBundle(copy: {
  en: Record<string, unknown>;
  ar: Record<string, unknown>;
}): Promise<SaveResult> {
  const enLocaleDict = enLocale as Record<string, unknown>;
  const arLocaleDict = arLocale as Record<string, unknown>;

  // Repair accidental cross-language saves, then store only real overrides.
  const repaired = {
    en: repairWrongLanguageCopy(copy.en, enLocaleDict, arLocaleDict),
    ar: repairWrongLanguageCopy(copy.ar, arLocaleDict, enLocaleDict),
  };
  const toPersist = {
    en: diffCopyAgainstLocale(repaired.en, enLocaleDict),
    ar: diffCopyAgainstLocale(repaired.ar, arLocaleDict),
  };

  return persistToFirebase(async () => {
    // Replace (not merge) so repaired/removed keys actually leave Firestore.
    await setDoc(doc(getDb(), "copy", "en"), toPersist.en);
    await setDoc(doc(getDb(), "copy", "ar"), toPersist.ar);
  }, {
copy: toPersist,
  });
}

export async function patchCopySection(
  language: "en" | "ar",
  section: string,
  value: Record<string, unknown>,
): Promise<SaveResult> {
  const store = loadCmsStore();
  const en = store.copy?.en ?? {};
  const ar = store.copy?.ar ?? {};
  const next = {
    en: language === "en" ? deepMergeCopy(en, { [section]: value }) : en,
    ar: language === "ar" ? deepMergeCopy(ar, { [section]: value }) : ar,
  };
  return saveCopyBundle(next);
}

export async function saveWhy(why: WhyContent): Promise<SaveResult> {
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "why", "main"), why, { merge: true });
  }, {
why,
  });
}

export async function saveTrust(trust: TrustContent): Promise<SaveResult> {
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "trust", "main"), trust, { merge: true });
  }, {
trust,
  });
}

function normalizeAdvertisement(row: AdvertisementContent): AdvertisementContent {
  const pkg = normalizeAdvertisementPackage(row.package, Boolean(row.featured));
  return {
    ...row,
    status: normalizeAdvertisementStatus(row.status),
    package: pkg,
    featured: pkg === "featured" || pkg === "vip",
    displayOrder: row.displayOrder ?? 0,
    logo: row.logo ?? "",
    image: row.image ?? "",
    websiteUrl: row.websiteUrl ?? "",
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
  };
}

/** Load advertisements from Firestore and keep the local CMS store in sync. */
export async function loadAdvertisements(): Promise<AdvertisementContent[]> {
  try {
    const snap = await getDocs(collection(getDb(), "advertisements"));
    const advertisements = snap.docs
      .map((d) =>
        normalizeAdvertisement({
          id: d.id,
          ...(d.data() as Omit<AdvertisementContent, "id">),
        }),
      )
      .filter((ad) => !String(ad.id).startsWith("sample-ad-"))
      .sort(
        (a, b) =>
          (a.displayOrder ?? Number.MAX_SAFE_INTEGER) - (b.displayOrder ?? Number.MAX_SAFE_INTEGER),
      );
    if (advertisements.length === 0 && !isCollectionManaged("advertisements")) {
      return (loadCmsStore().advertisements ?? []).map(normalizeAdvertisement);
    }
    patchCmsStore({ advertisements });
    return advertisements;
  } catch {
    return (loadCmsStore().advertisements ?? []).map(normalizeAdvertisement);
  }
}

export async function saveAdvertisements(
  advertisements: AdvertisementContent[],
): Promise<SaveResult> {
  const normalized = advertisements.map((item, index) =>
    normalizeAdvertisement({
      ...item,
      displayOrder: item.displayOrder ?? index + 1,
      updatedAt: new Date().toISOString(),
      createdAt: item.createdAt || new Date().toISOString(),
    }),
  );
  const keepIds = new Set(normalized.map((item) => item.id).filter(Boolean));
  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "advertisements"));
    const batch = writeBatch(db);

    for (const snap of existing.docs) {
      if (!keepIds.has(snap.id)) batch.delete(snap.ref);
    }

    normalized.forEach((item) => {
      const { id, ...data } = item;
      batch.set(doc(db, "advertisements", id), data, { merge: true });
    });
    await batch.commit();
  }, {
    advertisements: normalized,
  }, () => markCollectionManaged("advertisements"));
}

export async function saveServices(services: ServiceContent[]): Promise<SaveResult> {
  const keepIds = new Set(services.map((service) => service.id || service.slug).filter(Boolean));
  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "services"));
    const batch = writeBatch(db);

    for (const snap of existing.docs) {
      if (!keepIds.has(snap.id)) batch.delete(snap.ref);
    }

    services.forEach((service) => {
      const docId = service.id || service.slug;
      const { id: _id, ...data } = service;
      batch.set(doc(db, "services", docId), { ...data, id: docId }, { merge: true });
    });
    await batch.commit();
  }, {
    services,
  }, () => markCollectionManaged("services"));
}

export async function saveGallery(gallery: GalleryContent[]): Promise<SaveResult> {
  // Persist short refs only — never embed data: URLs (blows localStorage + Firestore limits).
  const safe = gallery.map((item, index) => ({
    id: item.id,
    src: item.src.startsWith("data:") ? "" : healGallerySrc(item.id, item.src),
    caption: item.caption,
    span: item.span ?? "normal",
    order: item.order ?? index + 1,
  }));
  const keepIds = new Set(safe.filter((item) => Boolean(item.src)).map((item) => item.id));
  const previous = loadCmsStore().gallery;

  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "gallery"));
    const batch = writeBatch(db);

    // Hard-delete removed gallery docs (and their media payloads when applicable).
    for (const snap of existing.docs) {
      if (keepIds.has(snap.id)) continue;
      batch.delete(snap.ref);
      const src = String((snap.data() as { src?: string }).src ?? "");
      const mid = mediaRefId(src);
      if (mid) batch.delete(doc(db, "media", mid));
    }

    // Also drop media for items removed from the local list but already missing remotely.
    for (const item of previous) {
      if (keepIds.has(item.id)) continue;
      const mid = mediaRefId(item.src);
      if (mid) batch.delete(doc(db, "media", mid));
    }

    for (const item of safe) {
      if (!item.src) {
        batch.delete(doc(db, "gallery", item.id));
        continue;
      }
      const { id, ...data } = item;
      batch.set(doc(db, "gallery", id), data, { merge: true });
    }

    await batch.commit();
  }, {
    gallery: safe.filter((item) => Boolean(item.src)),
  }, () => markGalleryManaged());
}

export async function fetchGalleryFromFirebase(): Promise<GalleryContent[]> {
  const snap = await getDocs(collection(getDb(), "gallery"));
  const gallery = snap.docs
    .map((item) => {
      const data = item.data() as Omit<GalleryContent, "id">;
      return {
        id: item.id,
        src: String(data.src ?? ""),
        caption: data.caption ?? { en: "", ar: "" },
        span: data.span ?? "normal",
        order: typeof data.order === "number" ? data.order : 0,
      } satisfies GalleryContent;
    })
    .filter((item) => Boolean(item.src))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (gallery.length || isGalleryManaged()) {
    patchCmsStore({ gallery, firebaseSync: "synced" });
  }
  return gallery;
}

export async function loadTestimonials(): Promise<TestimonialContent[]> {
  const enItems =
    (
      enLocale as {
        testimonials?: { items?: Array<{ name: string; position: string; review: string }> };
      }
    ).testimonials?.items ?? [];
  const arItems =
    (
      arLocale as {
        testimonials?: { items?: Array<{ name: string; position: string; review: string }> };
      }
    ).testimonials?.items ?? [];

  const fromLocales = (): TestimonialContent[] =>
    enItems.map((item, index) => ({
      id: `t${index + 1}`,
      clientName: { en: item.name, ar: arItems[index]?.name ?? "" },
      role: { en: item.position, ar: arItems[index]?.position ?? "" },
      text: { en: item.review, ar: arItems[index]?.review ?? "" },
      order: index + 1,
    }));

  const asLocalizedPair = (
    value: { en?: string; ar?: string } | string | undefined,
  ): { en: string; ar: string } => {
    if (!value) return { en: "", ar: "" };
    if (typeof value === "string") return { en: value, ar: "" };
    return { en: value.en ?? "", ar: value.ar ?? "" };
  };

  const repairPair = (
    value: { en?: string; ar?: string } | string | undefined,
    enFallback: string,
    arFallback: string,
  ) => {
    if (typeof value === "string") {
      return { en: value || enFallback, ar: arFallback || value };
    }
    const en = value?.en?.trim() || enFallback;
    let ar = value?.ar?.trim() || "";
    // Contaminated: Arabic side is empty or identical English copy.
    if (!ar || (ar === en && arFallback && arFallback !== en)) ar = arFallback;
    return { en, ar };
  };

  try {
    const snap = await getDocs(collection(getDb(), "testimonials"));
    let remote = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<TestimonialContent, "id">) }))
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

    if (remote.length) {
      remote = remote.map((row, index) => {
        const locale = fromLocales().find((item) => item.id === row.id) ?? fromLocales()[index];
        const locName = asLocalizedPair(locale?.clientName);
        const locRole = asLocalizedPair(locale?.role);
        const locText = asLocalizedPair(locale?.text);
        return {
          ...row,
          clientName: repairPair(row.clientName, locName.en, locName.ar),
          role: repairPair(row.role, locRole.en, locRole.ar),
          text: repairPair(row.text, locText.en, locText.ar),
        };
      });
      patchCmsStore({ testimonials: remote, firebaseSync: "synced" });
      return remote;
    }
  } catch {
    // fall through
  }

  const local = loadCmsStore().testimonials;
  if (local.length) {
    return local.map((row, index) => {
      const locale = fromLocales()[index];
      const locName = asLocalizedPair(locale?.clientName);
      const locRole = asLocalizedPair(locale?.role);
      const locText = asLocalizedPair(locale?.text);
      return {
        ...row,
        clientName: repairPair(row.clientName, locName.en, locName.ar),
        role: repairPair(row.role, locRole.en, locRole.ar),
        text: repairPair(row.text, locText.en, locText.ar),
      };
    });
  }

  return fromLocales();
}

export async function saveTestimonials(testimonials: TestimonialContent[]): Promise<SaveResult> {
  const keepIds = new Set(testimonials.map((item) => item.id).filter(Boolean));
  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "testimonials"));
    const batch = writeBatch(db);
    for (const snap of existing.docs) {
      if (!keepIds.has(snap.id)) batch.delete(snap.ref);
    }
    testimonials.forEach((item) => {
      const { id, ...data } = item;
      batch.set(doc(db, "testimonials", id), data, { merge: true });
    });
    await batch.commit();
  }, {
    testimonials,
  }, () => markCollectionManaged("testimonials"));
}

export async function loadFaq(): Promise<FaqContent[]> {
  try {
    const snap = await getDocs(collection(getDb(), "faq"));
    const remote = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<FaqContent, "id">) }))
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    if (remote.length) {
      patchCmsStore({ faq: remote, firebaseSync: "synced" });
      return remote;
    }
  } catch {
    // fall through
  }
  const local = loadCmsStore().faq;
  // Drop English-only mock contamination (ar identical to en / missing Arabic script).
  const usableLocal = local.filter((row) => {
    const q = typeof row.question === "string" ? row.question : (row.question?.ar ?? "");
    const a = typeof row.answer === "string" ? row.answer : (row.answer?.ar ?? "");
    return /[\u0600-\u06FF]/.test(q) || /[\u0600-\u06FF]/.test(a);
  });
  if (usableLocal.length) return usableLocal;

  const enItems =
    (enLocale as { faq?: { items?: Array<{ question: string; answer: string }> } }).faq?.items ??
    [];
  const arItems =
    (arLocale as { faq?: { items?: Array<{ question: string; answer: string }> } }).faq?.items ??
    [];
  return enItems.map((item, index) => ({
    id: `f${index + 1}`,
    question: { en: item.question, ar: arItems[index]?.question ?? "" },
    answer: { en: item.answer, ar: arItems[index]?.answer ?? "" },
    order: index + 1,
  }));
}

export async function saveFaq(faq: FaqContent[]): Promise<SaveResult> {
  const keepIds = new Set(faq.map((item) => item.id).filter(Boolean));
  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "faq"));
    const batch = writeBatch(db);
    for (const snap of existing.docs) {
      if (!keepIds.has(snap.id)) batch.delete(snap.ref);
    }
    faq.forEach((item) => {
      const { id, ...data } = item;
      batch.set(doc(db, "faq", id), data, { merge: true });
    });
    await batch.commit();
  }, {
    faq,
  }, () => markCollectionManaged("faq"));
}

export async function saveBlogPosts(blog: BlogContent[]): Promise<SaveResult> {
  const keepIds = new Set(blog.map((post) => post.slug || post.id).filter(Boolean) as string[]);
  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "blog"));
    const batch = writeBatch(db);
    for (const snap of existing.docs) {
      if (!keepIds.has(snap.id)) batch.delete(snap.ref);
    }
    blog.forEach((post) => {
      const docId = post.slug || post.id;
      batch.set(doc(db, "blog", docId), post, { merge: true });
    });
    await batch.commit();
  }, {
    blog,
  }, () => markCollectionManaged("blog"));
}

export async function saveSeoPage(pageId: SeoPageId, meta: SeoPageMeta): Promise<SaveResult> {
  const seo = { ...loadCmsStore().seo, [pageId]: meta };
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "seo", pageId), meta, { merge: true });
  }, {
    seo,
  });
}

export async function saveServiceSeo(slug: string, meta: SeoPageMeta): Promise<SaveResult> {
  const serviceSeo = { ...loadCmsStore().serviceSeo, [slug]: meta };
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "seo", `service_${slug}`), meta, { merge: true });
  }, {
    serviceSeo,
  });
}

export async function savePageHeader(pageId: PageHeaderId, imageUrl: string): Promise<SaveResult> {
  const normalized = normalizePageHeaderUrl(pageId, imageUrl);
  const pageHeaders = { ...loadCmsStore().pageHeaders, [pageId]: normalized };
  return persistToFirebase(async () => {
    await setDoc(doc(getDb(), "pageHeaders", pageId), { imageUrl: normalized }, { merge: true });
  }, {
    pageHeaders,
  });
}

export async function saveAllPageHeaders(
  pageHeaders: Partial<Record<PageHeaderId, string>>,
): Promise<SaveResult> {
  const normalized: Partial<Record<PageHeaderId, string>> = {};
  (Object.keys(pageHeaders) as PageHeaderId[]).forEach((id) => {
    const value = pageHeaders[id];
    if (value) normalized[id] = normalizePageHeaderUrl(id, value);
  });
  return persistToFirebase(
    async () => {
      const batch = writeBatch(getDb());
      Object.entries(normalized).forEach(([id, imageUrl]) => {
        if (imageUrl) batch.set(doc(getDb(), "pageHeaders", id), { imageUrl }, { merge: true });
      });
      await batch.commit();
    },
    {
      pageHeaders: { ...loadCmsStore().pageHeaders, ...normalized },
    },
  );
}

export async function saveAllSeo(
  seo: Partial<Record<SeoPageId, SeoPageMeta>>,
): Promise<SaveResult> {
  return persistToFirebase(async () => {
    const batch = writeBatch(getDb());
    Object.entries(seo).forEach(([id, meta]) => {
      if (meta) batch.set(doc(getDb(), "seo", id), meta, { merge: true });
    });
    await batch.commit();
  }, {
seo,
  });
}

export async function saveMessages(messages: CmsMessage[]): Promise<SaveResult> {
  const keepIds = new Set(messages.map((msg) => msg.id).filter(Boolean));
  return persistToFirebase(async () => {
    const db = getDb();
    const existing = await getDocs(collection(db, "messages"));
    const batch = writeBatch(db);
    for (const snap of existing.docs) {
      if (!keepIds.has(snap.id)) batch.delete(snap.ref);
    }
    messages.forEach((msg) => {
      batch.set(doc(db, "messages", msg.id), msg, { merge: true });
    });
    await batch.commit();
  }, {
    messages,
  }, () => markCollectionManaged("messages"));
}

export async function ingestContactLead(input: {
  name: string;
  email: string;
  phone: string;
  message: string;
  yachtType?: string;
  yachtLength?: string;
  yachtLocation?: string;
  serviceNeeded?: string;
}): Promise<CmsMessage> {
  const lead: CmsMessage = {
    id: `lead-${Date.now()}`,
    name: input.name.trim().slice(0, 120),
    email: input.email.trim().slice(0, 200),
    phone: (input.phone ?? "").trim().slice(0, 60),
    message: input.message.trim().slice(0, 5000),
    yachtType: input.yachtType,
    yachtLength: input.yachtLength,
    yachtLocation: input.yachtLocation,
    serviceNeeded: input.serviceNeeded,
    date: new Date().toISOString().slice(0, 10),
    status: "new",
    source: "contact-form",
  };

  const store = loadCmsStore();
  const messages = [lead, ...store.messages].slice(0, 100);

  try {
    await setDoc(doc(getDb(), "messages", lead.id), lead);
    patchCmsStore({ messages, firebaseSync: "synced" });
    notifySiteReload();
    return lead;
  } catch (error) {
    patchCmsStore({ firebaseSync: "error" });
    throw error instanceof Error ? error : new Error("FIREBASE_SAVE_FAILED");
  }
}

export async function fetchMessagesFromFirebase(): Promise<CmsMessage[]> {
  const snap = await getDocs(collection(getDb(), "messages"));
  const messages = snap.docs
    .map((item) => item.data() as CmsMessage)
    .filter((item) => item?.id && item?.email)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // Respect admin deletions: empty managed inbox stays empty.
  if (messages.length || isCollectionManaged("messages")) {
    patchCmsStore({ messages, firebaseSync: "synced" });
  }
  return messages;
}

const MAX_IMAGE_EDGE = 1920;
const JPEG_QUALITY = 0.82;
const MAX_DATA_URL_CHARS = 700_000; // under Firestore ~1MB doc limit
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STORAGE_BLOCKED_KEY = "lunaya.cms.storageBlocked";

export type UploadMediaOptions = {
  pathPrefix?: string;
  onProgress?: (percent: number) => void;
};

export class MediaUploadError extends Error {
  code: "INVALID_TYPE" | "FILE_TOO_LARGE" | "UPLOAD_FAILED" | "TOO_LARGE_AFTER_COMPRESS";
  constructor(code: MediaUploadError["code"], message?: string) {
    super(message || code);
    this.code = code;
  }
}

function assertValidImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new MediaUploadError("INVALID_TYPE");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new MediaUploadError("FILE_TOO_LARGE");
  }
}

function extensionForType(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function isStorageBlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_BLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markStorageBlocked() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_BLOCKED_KEY, "1");
  } catch {
    // ignore
  }
}

function clearStorageBlocked() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_BLOCKED_KEY);
  } catch {
    // ignore
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new MediaUploadError("UPLOAD_FAILED"));
    reader.readAsDataURL(blob);
  });
}

async function fileToUploadBlob(
  file: File,
  quality = JPEG_QUALITY,
  maxEdge = MAX_IMAGE_EDGE,
): Promise<{ blob: Blob; contentType: string }> {
  // Small non-JPEG files can skip re-encode.
  if (file.size <= 900_000 && (file.type === "image/png" || file.type === "image/webp")) {
    return { blob: file, contentType: file.type };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MediaUploadError("UPLOAD_FAILED", "Canvas unavailable.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Prefer JPEG for Firestore size limits (png/webp often stay too large as data URLs).
  const contentType = "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) reject(new MediaUploadError("UPLOAD_FAILED", "Compression failed."));
        else resolve(result);
      },
      contentType,
      quality,
    );
  });

  return { blob, contentType };
}

async function fileToCompressedDataUrl(
  file: File,
): Promise<{ dataUrl: string; contentType: string }> {
  const attempts: Array<{ quality: number; maxEdge: number }> = [
    { quality: 0.82, maxEdge: 1920 },
    { quality: 0.72, maxEdge: 1600 },
    { quality: 0.62, maxEdge: 1280 },
    { quality: 0.52, maxEdge: 1024 },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const { blob, contentType } = await fileToUploadBlob(file, attempt.quality, attempt.maxEdge);
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrl.length <= MAX_DATA_URL_CHARS) {
        return { dataUrl, contentType };
      }
      lastError = new MediaUploadError("TOO_LARGE_AFTER_COMPRESS");
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof MediaUploadError) throw lastError;
  throw new MediaUploadError("TOO_LARGE_AFTER_COMPRESS");
}

async function uploadToFirebaseStorage(
  blob: Blob,
  contentType: string,
  pathPrefix: string,
  onProgress?: (percent: number) => void,
): Promise<{ id: string; url: string; storagePath: string; contentType: string }> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = extensionForType(contentType);
  const safePrefix = pathPrefix.replace(/^\/+|\/+$/g, "") || "uploads";
  const storagePath = `uploads/${safePrefix}/${id}.${ext}`;
  const storageRef = ref(getFirebaseStorage(), storagePath);

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, {
      contentType,
      cacheControl: "public,max-age=31536000",
    });
    const timer = window.setTimeout(() => {
      try {
        task.cancel();
      } catch {
        // ignore
      }
      reject(new Error("storage-upload-timeout"));
    }, 20_000);

    task.on(
      "state_changed",
      (snapshot) => {
        if (!onProgress || !snapshot.totalBytes) return;
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress(Math.min(99, Math.max(0, percent)));
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
      () => {
        window.clearTimeout(timer);
        resolve();
      },
    );
  });

  const url = await getDownloadURL(storageRef);
  onProgress?.(100);
  return { id, url, storagePath, contentType };
}

async function saveMediaToFirestore(input: {
  id: string;
  pathPrefix: string;
  name: string;
  contentType: string;
  dataUrl?: string;
  url?: string;
  storagePath?: string;
  fallbackReason?: string;
}) {
  await setDoc(doc(getDb(), "media", input.id), {
    id: input.id,
    pathPrefix: input.pathPrefix,
    name: input.name,
    contentType: input.contentType,
    ...(input.url ? { url: input.url } : {}),
    ...(input.storagePath ? { storagePath: input.storagePath } : {}),
    ...(input.dataUrl ? { dataUrl: input.dataUrl } : {}),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Upload image permanently.
 * Saves compressed image to Firestore `media/{id}` (works today with existing rules).
 * Optionally upgrades to Firebase Storage HTTPS when `VITE_FIREBASE_STORAGE_UPLOADS=1`
 * and Storage rules/CORS are deployed.
 */
export async function uploadMediaFile(
  file: File,
  pathPrefixOrOptions: string | UploadMediaOptions = "uploads",
): Promise<string> {
  const options =
    typeof pathPrefixOrOptions === "string"
      ? { pathPrefix: pathPrefixOrOptions }
      : pathPrefixOrOptions;
  const pathPrefix = options.pathPrefix || "uploads";

  assertValidImageFile(file);
  options.onProgress?.(8);

  const preferStorage =
    String(
      (import.meta.env as Record<string, string | undefined>).VITE_FIREBASE_STORAGE_UPLOADS || "",
    )
      .trim()
      .toLowerCase() === "1" && !isStorageBlocked();

  if (preferStorage) {
    try {
      const prepared = await fileToUploadBlob(file);
      options.onProgress?.(20);
      const uploaded = await uploadToFirebaseStorage(
        prepared.blob,
        prepared.contentType,
        pathPrefix,
        options.onProgress,
      );
      cacheMediaDataUrl(uploaded.id, uploaded.url);
      await saveMediaToFirestore({
        id: uploaded.id,
        pathPrefix,
        name: file.name,
        contentType: uploaded.contentType,
        url: uploaded.url,
        storagePath: uploaded.storagePath,
      });
      clearStorageBlocked();
      options.onProgress?.(100);
      return uploaded.url;
    } catch (storageError) {
      markStorageBlocked();
      if (typeof console !== "undefined") {
        console.warn(
          "[media-upload] Firebase Storage unavailable (rules/CORS). Saving permanently to Firestore instead.",
          storageError,
        );
      }
    }
  }

  options.onProgress?.(35);
  const { dataUrl, contentType } = await fileToCompressedDataUrl(file);
  options.onProgress?.(70);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  cacheMediaDataUrl(id, dataUrl);
  try {
    await saveMediaToFirestore({
      id,
      pathPrefix,
      name: file.name,
      contentType,
      dataUrl,
      fallbackReason: preferStorage ? "storage-blocked" : "firestore-primary",
    });
  } catch (error) {
    throw new MediaUploadError(
      "UPLOAD_FAILED",
      error instanceof Error ? error.message : "Firestore media save failed",
    );
  }
  options.onProgress?.(100);
  return toMediaRef(id);
}

export function defaultSettingsFromMock(): SiteSettings {
  return {
    companyName: "lunayairmarina",
    phone: companyInfo.phone,
    phoneDisplay: companyInfo.phoneDisplay,
    whatsapp: companyInfo.whatsapp,
    email: companyInfo.email,
    address: { en: companyInfo.addressEn, ar: companyInfo.addressAr },
    socialLinks: { ...companyInfo.social },
  };
}
