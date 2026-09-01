import type { Firestore } from "firebase-admin/firestore";
import enLocale from "@/locales/en.json";
import arLocale from "@/locales/ar.json";
import { companyInfo } from "@/data/companyInfo";
import { DEFAULT_BLOG_POSTS, type BlogPost } from "@/data/blogCore";
import { SERVICE_SLUGS } from "@/data/serviceSlugs";
import type {
  AboutContent,
  AdvertisementContent,
  FaqContent,
  FleetItem,
  HomepageContent,
  LocationContent,
  ServiceContent,
  SiteSettings,
  TeamMember,
  TestimonialContent,
  TrustContent,
  WhyContent,
} from "@/types/content";
import {
  mergeFleet,
  mergeGallery,
  mergeTeam,
  mergeTestimonials,
  type KnowledgeSourceBundle,
  type LocaleBundle,
} from "./loadSource";

async function getSingleton<T>(db: Firestore, path: string, id: string) {
  try {
    const snap = await db.collection(path).doc(id).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...(snap.data() as T) };
  } catch {
    return null;
  }
}

async function getCollectionOrdered<T>(
  db: Firestore,
  name: string,
  orderField = "order",
): Promise<Array<T & { id: string }>> {
  try {
    const snap = await db.collection(name).orderBy(orderField, "asc").get();
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() as T) }));
  } catch {
    try {
      const snap = await db.collection(name).get();
      return snap.docs.map((item) => ({ id: item.id, ...(item.data() as T) }));
    } catch {
      return [];
    }
  }
}

function defaultSettings(): SiteSettings {
  return {
    companyName: "lunayairmarina",
    phone: companyInfo.phone,
    phoneDisplay: companyInfo.phoneDisplay,
    whatsapp: companyInfo.whatsapp,
    email: companyInfo.email,
    address: {
      en: companyInfo.addressEn,
      ar: companyInfo.addressAr,
    },
    socialLinks: { ...companyInfo.social },
  };
}

function normalizeBlogPosts(remote: Array<BlogPost & { id: string }>): BlogPost[] {
  const map = new Map<string, BlogPost>();
  for (const post of DEFAULT_BLOG_POSTS) map.set(post.slug, post);
  for (const raw of remote) {
    const slug = raw.slug?.trim();
    if (!slug) continue;
    map.set(slug, {
      ...map.get(slug),
      ...raw,
      id: raw.id || raw.slug,
      slug,
      status: raw.status === "draft" ? "draft" : "published",
    } as BlogPost);
  }
  return [...map.values()].filter((post) => post.status === "published");
}

function localeFaqFromLocales(): FaqContent[] {
  const enItems =
    (enLocale as { faq?: { items?: Array<{ question: string; answer: string }> } }).faq?.items ??
    [];
  const arItems =
    (arLocale as { faq?: { items?: Array<{ question: string; answer: string }> } }).faq?.items ??
    [];
  const count = Math.max(enItems.length, arItems.length);
  return Array.from({ length: count }, (_, index) => ({
    id: `locale-f${index + 1}`,
    question: {
      en: enItems[index]?.question ?? "",
      ar: arItems[index]?.question ?? "",
    },
    answer: {
      en: enItems[index]?.answer ?? "",
      ar: arItems[index]?.answer ?? "",
    },
    order: index + 1,
  }));
}

function mergeFaq(remote: FaqContent[]): FaqContent[] {
  if (remote.length > 0) return remote;
  return localeFaqFromLocales();
}

function mergeServices(remote: ServiceContent[]): ServiceContent[] {
  const map = new Map<string, ServiceContent>();
  for (const slug of SERVICE_SLUGS) {
    map.set(slug, {
      id: slug,
      slug,
      title: { en: slug, ar: slug },
      description: { en: "", ar: "" },
      image: "",
      features: [],
      order: SERVICE_SLUGS.indexOf(slug) + 1,
    });
  }
  for (const service of remote) {
    if (service.slug) map.set(service.slug, { ...map.get(service.slug), ...service });
  }
  return [...map.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** Loads CMS + locale sources using Admin SDK (server-side, bypasses security rules). */
export async function loadKnowledgeSourceBundleAdmin(
  db: Firestore,
): Promise<KnowledgeSourceBundle> {
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
    faq,
    gallery,
  ] = await Promise.all([
    getSingleton<SiteSettings>(db, "settings", "general"),
    getSingleton<HomepageContent>(db, "homepage", "main"),
    getSingleton<AboutContent>(db, "about", "main"),
    getSingleton<WhyContent>(db, "why", "main"),
    getSingleton<TrustContent>(db, "trust", "main"),
    getCollectionOrdered<ServiceContent>(db, "services"),
    getCollectionOrdered<FleetItem>(db, "fleet"),
    getCollectionOrdered<TeamMember>(db, "team"),
    getCollectionOrdered<TestimonialContent>(db, "testimonials"),
    getCollectionOrdered<AdvertisementContent>(db, "advertisements", "displayOrder"),
    getCollectionOrdered<LocationContent>(db, "locations"),
    getCollectionOrdered<BlogPost & { id: string }>(db, "blog", "date"),
    getCollectionOrdered<FaqContent>(db, "faq"),
    getCollectionOrdered<{ caption?: { en?: string; ar?: string } | string }>(db, "gallery"),
  ]);

  const locales: LocaleBundle = {
    en: enLocale as Record<string, unknown>,
    ar: arLocale as Record<string, unknown>,
  };

  return {
    settings: settings
      ? {
          ...defaultSettings(),
          ...settings,
          address: { ...defaultSettings().address, ...settings.address },
          socialLinks: { ...defaultSettings().socialLinks, ...settings.socialLinks },
        }
      : defaultSettings(),
    homepage,
    about,
    why,
    trust,
    services: mergeServices(services),
    fleet: mergeFleet(fleet),
    team: mergeTeam(team),
    testimonials: mergeTestimonials(testimonials),
    advertisements,
    locations,
    blog: normalizeBlogPosts(blog),
    faq: mergeFaq(faq),
    gallery: mergeGallery(gallery),
    locales,
    fetchedAt: new Date().toISOString(),
  };
}
