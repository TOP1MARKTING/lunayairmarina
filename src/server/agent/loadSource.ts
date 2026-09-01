import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";
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
import { isPlaceholderTeamBio, pickLocalized } from "./normalize";

export interface LocaleBundle {
  en: Record<string, unknown>;
  ar: Record<string, unknown>;
}

/** Caption-only gallery knowledge (no image bytes). */
export interface GalleryCaptionItem {
  id: string;
  caption: { en: string; ar: string };
}

export interface KnowledgeSourceBundle {
  settings: SiteSettings;
  homepage: HomepageContent | null;
  about: AboutContent | null;
  why: WhyContent | null;
  trust: TrustContent | null;
  services: ServiceContent[];
  fleet: FleetItem[];
  team: TeamMember[];
  testimonials: TestimonialContent[];
  advertisements: AdvertisementContent[];
  locations: LocationContent[];
  blog: BlogPost[];
  faq: FaqContent[];
  gallery: GalleryCaptionItem[];
  locales: LocaleBundle;
  fetchedAt: string;
}

/** Public portfolio examples used on the site when Firestore fleet is empty (same as seed). */
export const DEFAULT_FLEET_PORTFOLIO: FleetItem[] = [
  {
    id: "y1",
    yachtName: "Lunayair Dawn",
    yachtType: { en: "Motor Yacht", ar: "يخت آلي" },
    yachtLength: "38 m",
    image: "",
    description: {
      en: "Managed motor yacht programme with planned maintenance and crew oversight.",
      ar: "برنامج إدارة يخت آلي مع صيانة مخططة وإشراف على الطاقم.",
    },
    order: 1,
  },
  {
    id: "y2",
    yachtName: "Coral Explorer",
    yachtType: { en: "Explorer", ar: "يخت استكشاف" },
    yachtLength: "45 m",
    image: "",
    description: {
      en: "Explorer yacht under full technical and operational management.",
      ar: "يخت استكشاف تحت إدارة فنية وتشغيلية كاملة.",
    },
    order: 2,
  },
  {
    id: "y3",
    yachtName: "Meridian",
    yachtType: { en: "Sailing Yacht", ar: "يخت شراعي" },
    yachtLength: "52 m",
    image: "",
    description: {
      en: "Sailing yacht with compliance, crew and seasonal readiness support.",
      ar: "يخت شراعي مع دعم الامتثال والطواقم والاستعداد الموسمي.",
    },
    order: 3,
  },
];

/** Public gallery captions used on the site (textual metadata only; matches mock/seed). */
export const DEFAULT_GALLERY_CAPTIONS: GalleryCaptionItem[] = [
  { id: "g1", caption: { en: "Illuminated stern at night", ar: "مؤخرة اليخت المضيئة ليلًا" } },
  {
    id: "g2",
    caption: { en: "Transom branding at golden hour", ar: "شعار الترانزم عند الغروب" },
  },
  { id: "g3", caption: { en: "Brand mark on the hull", ar: "شعار المارينا على الهيكل" } },
  { id: "g4", caption: { en: "Owner briefing on the bridge", ar: "اجتماع المالك في غرفة القيادة" } },
  { id: "g5", caption: { en: "Bow cutting open water", ar: "مقدمة اليخت في المياه المفتوحة" } },
  { id: "g6", caption: { en: "Visiting yacht at the pier", ar: "يخت زائر عند الرصيف" } },
  { id: "g7", caption: { en: "Crew on deck briefing", ar: "إحاطة الطاقم على السطح" } },
  { id: "g8", caption: { en: "Fleet convoy from the air", ar: "قافلة اليخوت من الجو" } },
];

async function getSingleton<T>(db: Firestore, path: string, id: string) {
  try {
    const snap = await getDoc(doc(db, path, id));
    if (!snap.exists()) return null;
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
    const q = query(collection(db, name), orderBy(orderField, "asc"));
    const snap = await getDocs(q);
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() as T) }));
  } catch {
    try {
      const snap = await getDocs(collection(db, name));
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
    const slug = raw.slug || raw.id;
    if (!slug) continue;
    map.set(slug, { ...map.get(slug), ...raw, slug });
  }
  return [...map.values()];
}

function localeFaqFromLocales(): FaqContent[] {
  const enItems =
    (enLocale as { faq?: { items?: Array<{ question: string; answer: string }> } }).faq?.items ??
    [];
  const arItems =
    (arLocale as { faq?: { items?: Array<{ question: string; answer: string }> } }).faq?.items ??
    [];
  return enItems.map((item, index) => ({
    id: `locale-f${index + 1}`,
    question: {
      en: item.question,
      ar: arItems[index]?.question ?? "",
    },
    answer: {
      en: item.answer,
      ar: arItems[index]?.answer ?? "",
    },
    order: index + 1,
  }));
}

function mergeFaq(remote: FaqContent[]): FaqContent[] {
  if (remote.length > 0) return remote;
  return localeFaqFromLocales();
}

function localeTestimonialsFromLocales(): TestimonialContent[] {
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
  return enItems.map((item, index) => ({
    id: `locale-t${index + 1}`,
    clientName: { en: item.name, ar: arItems[index]?.name ?? item.name },
    role: { en: item.position, ar: arItems[index]?.position ?? "" },
    text: { en: item.review, ar: arItems[index]?.review ?? "" },
    order: index + 1,
  }));
}

export function mergeTestimonials(remote: TestimonialContent[]): TestimonialContent[] {
  if (remote.length > 0) return remote;
  return localeTestimonialsFromLocales();
}

export function mergeFleet(remote: FleetItem[]): FleetItem[] {
  if (remote.length > 0) return remote;
  return DEFAULT_FLEET_PORTFOLIO;
}

export function mergeTeam(remote: TeamMember[]): TeamMember[] {
  return remote.filter((member) => {
    const bio = `${pickLocalized(member.bio, "en")} ${pickLocalized(member.bio, "ar")}`;
    return bio.trim().length > 0 && !isPlaceholderTeamBio(bio);
  });
}

export function mergeGallery(
  remote: Array<{ id: string; caption?: { en?: string; ar?: string } | string }>,
): GalleryCaptionItem[] {
  const fromRemote = remote
    .map((item) => {
      const caption =
        typeof item.caption === "string"
          ? { en: item.caption, ar: item.caption }
          : {
              en: item.caption?.en?.trim() ?? "",
              ar: item.caption?.ar?.trim() ?? "",
            };
      if (!caption.en && !caption.ar) return null;
      return {
        id: item.id,
        caption: { en: caption.en || caption.ar, ar: caption.ar || caption.en },
      };
    })
    .filter((item): item is GalleryCaptionItem => Boolean(item));
  if (fromRemote.length > 0) return fromRemote;
  return DEFAULT_GALLERY_CAPTIONS;
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

export async function loadKnowledgeSourceBundle(db: Firestore): Promise<KnowledgeSourceBundle> {
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
    locales: {
      en: enLocale as Record<string, unknown>,
      ar: arLocale as Record<string, unknown>,
    },
    fetchedAt: new Date().toISOString(),
  };
}

export function loadStaticKnowledgeSourceBundle(): KnowledgeSourceBundle {
  return {
    settings: defaultSettings(),
    homepage: null,
    about: null,
    why: null,
    trust: null,
    services: mergeServices([]),
    fleet: mergeFleet([]),
    team: mergeTeam([]),
    testimonials: mergeTestimonials([]),
    advertisements: [],
    locations: [],
    blog: normalizeBlogPosts([]),
    faq: mergeFaq([]),
    gallery: mergeGallery([]),
    locales: {
      en: enLocale as Record<string, unknown>,
      ar: arLocale as Record<string, unknown>,
    },
    fetchedAt: new Date().toISOString(),
  };
}

export function getLocaleSection(
  locales: LocaleBundle,
  language: "en" | "ar",
  key: string,
): unknown {
  return locales[language]?.[key];
}
