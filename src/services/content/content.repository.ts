/**
 * Content repository: Firestore reads, session/memory cache, and CMS localStorage overlay.
 * Prefer importing the public API from `@/services/content` (content.service).
 */
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  deepMergeCopy,
  diffCopyAgainstLocale,
  emptyCmsStore,
  isCollectionManaged,
  loadCmsStore,
  repairWrongLanguageCopy,
  saveCmsStore,
} from "@/lib/cms-store";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";
import type {
  AboutContent,
  AdvertisementContent,
  BlogContent,
  FaqContent,
  FleetItem,
  GalleryContent,
  HomepageContent,
  LocationContent,
  ServiceContent,
  SiteBundle,
  SiteSettings,
  TeamMember,
  TestimonialContent,
  TrustContent,
  WhyContent,
} from "@/types/content";

const CACHE_KEY = "lunayairmarina.content.bundle.v3";
/** Short TTL so public visitors pick up admin Firebase updates quickly. */
const CACHE_TTL_MS = 1000 * 30;

let memoryCache: SiteBundle | null = null;
let inflight: Promise<SiteBundle> | null = null;

function readSessionCache(): SiteBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SiteBundle;
    if (!parsed?.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(bundle: SiteBundle) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(bundle));
  } catch {
    // Ignore quota / private mode failures.
  }
}

async function getSingleton<T>(path: string, id: string): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(doc(getDb(), path, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as T) };
}

async function getCollectionOrdered<T>(name: string, orderField = "order"): Promise<T[]> {
  try {
    const q = query(collection(getDb(), name), orderBy(orderField, "asc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
  } catch {
    const snap = await getDocs(collection(getDb(), name));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
  }
}

function stripId<T extends object>(value: T & { id?: string }): T {
  const { id: _id, ...rest } = value as T & { id?: string };
  return rest as T;
}

/** Merge CMS + remote lists by id (CMS wins on conflict; keep remote-only uploads). */
function mergeById<T extends { id: string; order?: number }>(cms: T[], remote: T[]): T[] {
  if (!cms.length) return remote;
  if (!remote.length) return cms;
  const map = new Map<string, T>();
  for (const item of remote) map.set(item.id, item);
  for (const item of cms) map.set(item.id, item);
  return Array.from(map.values()).sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Firebase is the source of truth. Local CMS is only a cache / offline display fallback. */
function preferRemoteCollection<T extends { id: string }>(
  local: T[],
  remote: T[],
  managed = false,
): T[] {
  if (managed) return remote;
  if (remote.length > 0) return remote;
  return local;
}

function preferRemoteGallery(local: GalleryContent[], remote: GalleryContent[]): GalleryContent[] {
  // Managed gallery is a full Firebase snapshot (including intentional empties).
  if (isCollectionManaged("gallery")) return remote;
  if (remote.length > 0) return remote;
  return local;
}

function emptyBundle(): SiteBundle {
  return {
    settings: null,
    homepage: null,
    about: null,
    why: null,
    trust: null,
    services: [],
    fleet: [],
    team: [],
    testimonials: [],
    advertisements: [],
    locations: [],
    blog: [],
    gallery: [],
    faq: [],
    copy: null,
    fetchedAt: Date.now(),
  };
}

async function hydrateLocalCmsFromCloud() {
  try {
    const local = loadCmsStore();
    const isEmpty =
      !local.settings &&
      !local.homepage &&
      !local.copy &&
      local.services.length === 0 &&
      local.blog.length === 0 &&
      local.gallery.length === 0 &&
      local.team.length === 0 &&
      local.faq.length === 0 &&
      local.testimonials.length === 0 &&
      local.advertisements.length === 0 &&
      !isCollectionManaged("services") &&
      !isCollectionManaged("blog") &&
      !isCollectionManaged("gallery") &&
      !isCollectionManaged("team") &&
      !isCollectionManaged("faq") &&
      !isCollectionManaged("testimonials") &&
      !isCollectionManaged("advertisements") &&
      !isCollectionManaged("messages");
    if (!isEmpty) return;

    const snap = await getDoc(doc(getDb(), "cms", "v1"));
    if (!snap.exists()) return;
    const remote = snap.data() as Partial<ReturnType<typeof loadCmsStore>>;
    saveCmsStore({
      ...emptyCmsStore(),
      ...remote,
      firebaseSync: "synced",
      updatedAt: remote.updatedAt || new Date().toISOString(),
    });
  } catch {
    // Ignore hydrate failures.
  }
}

async function fetchBundleFromFirebase(): Promise<SiteBundle> {
  await hydrateLocalCmsFromCloud();
  try {
    const [
      settings,
      homepage,
      about,
      why,
      trust,
      services,
      fleet,
      team,
      testimonials,
      advertisements,
      locations,
      blog,
      gallery,
      faq,
      copyEn,
      copyAr,
    ] = await Promise.all([
      getSingleton<SiteSettings>("settings", "general"),
      getSingleton<HomepageContent>("homepage", "main"),
      getSingleton<AboutContent>("about", "main"),
      getSingleton<WhyContent>("why", "main"),
      getSingleton<TrustContent>("trust", "main"),
      getCollectionOrdered<ServiceContent>("services"),
      getCollectionOrdered<FleetItem>("fleet"),
      getCollectionOrdered<TeamMember>("team"),
      getCollectionOrdered<TestimonialContent>("testimonials"),
      getCollectionOrdered<AdvertisementContent>("advertisements", "displayOrder"),
      getCollectionOrdered<LocationContent>("locations"),
      getCollectionOrdered<BlogContent>("blog", "date"),
      getCollectionOrdered<GalleryContent>("gallery"),
      getCollectionOrdered<FaqContent>("faq"),
      getDoc(doc(getDb(), "copy", "en")),
      getDoc(doc(getDb(), "copy", "ar")),
    ]);

    const copy =
      copyEn.exists() || copyAr.exists()
        ? {
            en: (copyEn.data() as Record<string, unknown>) ?? {},
            ar: (copyAr.data() as Record<string, unknown>) ?? {},
          }
        : null;

    return {
      settings: settings ? stripId(settings) : null,
      homepage: homepage ? stripId(homepage) : null,
      about: about ? stripId(about) : null,
      why: why ? stripId(why) : null,
      trust: trust ? stripId(trust) : null,
      services,
      fleet,
      team,
      testimonials,
      advertisements,
      locations,
      blog: blog.sort((a, b) => String(b.date).localeCompare(String(a.date))),
      gallery,
      faq,
      copy,
      fetchedAt: Date.now(),
    };
  } catch {
    return emptyBundle();
  }
}

/** CMS local store is a cache; Firebase wins when present. */
function looksLikeI18nKey(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(value.trim());
}

function isCorruptedLocalized(value: { en?: string; ar?: string } | undefined): boolean {
  if (!value) return true;
  return looksLikeI18nKey(value.en) || looksLikeI18nKey(value.ar);
}

function sanitizeHomepageForBundle(homepage: HomepageContent | null): HomepageContent | null {
  if (!homepage) return null;
  if (
    isCorruptedLocalized(homepage.heroTitle) ||
    isCorruptedLocalized(homepage.heroEyebrow) ||
    isCorruptedLocalized(homepage.heroDescription)
  ) {
    return null;
  }
  return homepage;
}

function mergeCmsOverFirebase(remote: SiteBundle): SiteBundle {
  const cms = loadCmsStore();
  const enLocaleDict = enLocale as Record<string, unknown>;
  const arLocaleDict = arLocale as Record<string, unknown>;

  let copy =
    remote.copy || cms.copy
      ? {
          en: repairWrongLanguageCopy(
            deepMergeCopy(cms.copy?.en, remote.copy?.en),
            enLocaleDict,
            arLocaleDict,
          ),
          ar: repairWrongLanguageCopy(
            deepMergeCopy(cms.copy?.ar, remote.copy?.ar),
            arLocaleDict,
            enLocaleDict,
          ),
        }
      : null;

  // Persist repaired Arabic/English copy so the UI stops flipping languages.
  // Store diffs only — never dump the full locale tree into CMS localStorage.
  if (copy && cms.copy) {
    const arWasContaminated = JSON.stringify(cms.copy.ar ?? {}) !== JSON.stringify(copy.ar);
    const enWasContaminated = JSON.stringify(cms.copy.en ?? {}) !== JSON.stringify(copy.en);
    if (arWasContaminated || enWasContaminated) {
      saveCmsStore({
        ...cms,
        copy: {
          en: diffCopyAgainstLocale(copy.en ?? {}, enLocaleDict),
          ar: diffCopyAgainstLocale(copy.ar ?? {}, arLocaleDict),
        },
        homepage: sanitizeHomepageForBundle(cms.homepage),
      });
      copy = {
        en: repairWrongLanguageCopy(copy.en, enLocaleDict, arLocaleDict),
        ar: repairWrongLanguageCopy(copy.ar, arLocaleDict, enLocaleDict),
      };
    }
  }

  const homepage =
    sanitizeHomepageForBundle(remote.homepage) ?? sanitizeHomepageForBundle(cms.homepage);

  // Drop corrupted homepage from local CMS so it stops overriding locales.
  if (cms.homepage && !sanitizeHomepageForBundle(cms.homepage)) {
    saveCmsStore({ ...loadCmsStore(), homepage: null });
  }

  return {
    settings: remote.settings ?? cms.settings,
    homepage,
    about: remote.about ?? cms.about,
    why: remote.why ?? cms.why,
    trust: remote.trust ?? cms.trust,
    services: preferRemoteCollection(cms.services, remote.services, isCollectionManaged("services")),
    fleet: preferRemoteCollection(cms.fleet, remote.fleet, isCollectionManaged("fleet")),
    team: preferRemoteCollection(cms.team, remote.team, isCollectionManaged("team")),
    testimonials: preferRemoteCollection(
      cms.testimonials,
      remote.testimonials,
      isCollectionManaged("testimonials"),
    ),
    advertisements: preferRemoteCollection(
      cms.advertisements,
      remote.advertisements,
      isCollectionManaged("advertisements"),
    ),
    locations: remote.locations,
    blog: preferRemoteCollection(cms.blog, remote.blog, isCollectionManaged("blog")),
    gallery: preferRemoteGallery(cms.gallery, remote.gallery),
    faq: preferRemoteCollection(cms.faq, remote.faq, isCollectionManaged("faq")),
    copy,
    fetchedAt: Date.now(),
  };
}

export async function getSiteContent(options?: { force?: boolean }): Promise<SiteBundle> {
  if (!options?.force) {
    if (memoryCache) return memoryCache;
    const session = readSessionCache();
    if (session) {
      memoryCache = session;
      return session;
    }
    if (inflight) return inflight;
  }

  inflight = fetchBundleFromFirebase()
    .then((bundle) => {
      const merged = mergeCmsOverFirebase(bundle);
      memoryCache = merged;
      writeSessionCache(merged);
      return merged;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearContentCache() {
  memoryCache = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(CACHE_KEY);
  }
}
