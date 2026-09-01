import type { Language } from "@/lib/i18n";
import { loadCmsStore } from "@/lib/cms-store";
import { absoluteUrl as siteAbsoluteUrl } from "@/lib/site";
import {
  BLOG_STORAGE_KEY,
  DEFAULT_BLOG_POSTS,
  tx as txCore,
  type BlogBlock,
  type BlogInline,
  type BlogPost,
  type Localized,
} from "./blogCore";

export type { BlogBlock, BlogInline, BlogPost, Localized } from "./blogCore";
export { BLOG_STORAGE_KEY, DEFAULT_BLOG_POSTS } from "./blogCore";

/** @deprecated import from ./blogCore — re-export for existing client imports */
export function tx(value: Localized | string | undefined, language: Language): string {
  return txCore(value, language);
}

const gallery1 = "/images/gallery/gallery-01-marina.jpg";

function asLocalized(value: unknown, fallback = ""): Localized {
  if (value && typeof value === "object" && "en" in (value as object)) {
    const loc = value as Localized;
    return { en: loc.en || fallback, ar: loc.ar || loc.en || fallback };
  }
  if (typeof value === "string") return { en: value, ar: value };
  return { en: fallback, ar: fallback };
}

function normalizeInline(span: unknown): BlogInline {
  const raw = span as { type?: string; text?: unknown; href?: string };
  if (raw?.type === "keyword") {
    return { type: "keyword", text: asLocalized(raw.text), href: raw.href || "/services" };
  }
  return { type: "text", text: asLocalized(raw?.text) };
}

function normalizeBlock(block: unknown): BlogBlock | null {
  const raw = block as BlogBlock & {
    text?: unknown;
    alt?: unknown;
    caption?: unknown;
    spans?: unknown[];
  };
  if (!raw?.id || !raw?.type) return null;
  if (raw.type === "paragraph") {
    return {
      id: raw.id,
      type: "paragraph",
      spans: Array.isArray(raw.spans) ? raw.spans.map(normalizeInline) : [],
    };
  }
  if (raw.type === "heading") {
    return {
      id: raw.id,
      type: "heading",
      level: raw.level === 3 ? 3 : 2,
      text: asLocalized(raw.text),
    };
  }
  if (raw.type === "image") {
    return {
      id: raw.id,
      type: "image",
      src: typeof raw.src === "string" ? raw.src : gallery1,
      alt: asLocalized(raw.alt),
      caption: raw.caption ? asLocalized(raw.caption) : undefined,
    };
  }
  if (raw.type === "quote") {
    return { id: raw.id, type: "quote", text: asLocalized(raw.text) };
  }
  return null;
}

export function normalizePost(raw: unknown): BlogPost | null {
  if (!raw || typeof raw !== "object") return null;
  const post = raw as Record<string, unknown>;
  if (typeof post.id !== "string" || typeof post.slug !== "string") return null;
  const blocks = Array.isArray(post.blocks)
    ? post.blocks.map(normalizeBlock).filter((b): b is BlogBlock => Boolean(b))
    : [];
  const tags = Array.isArray(post.tags) ? post.tags.map((tag) => asLocalized(tag)) : [];
  return {
    id: post.id,
    slug: post.slug,
    title: asLocalized(post.title),
    excerpt: asLocalized(post.excerpt),
    coverImage: typeof post.coverImage === "string" ? post.coverImage : gallery1,
    coverAlt: asLocalized(post.coverAlt),
    author: asLocalized(post.author, "lunayairmarina"),
    publishedAt: typeof post.publishedAt === "string" ? post.publishedAt : new Date().toISOString(),
    updatedAt: typeof post.updatedAt === "string" ? post.updatedAt : new Date().toISOString(),
    status: post.status === "draft" ? "draft" : "published",
    seoTitle: asLocalized(post.seoTitle),
    seoDescription: asLocalized(post.seoDescription),
    focusKeyword: asLocalized(post.focusKeyword),
    tags,
    blocks,
    category: post.category ? asLocalized(post.category) : undefined,
    featured: Boolean(post.featured),
  };
}

function readStoredPosts(): BlogPost[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BLOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return null;
    const posts = parsed.map(normalizePost).filter((p): p is BlogPost => Boolean(p));
    return posts.length ? posts : null;
  } catch {
    return null;
  }
}

export function loadBlogPosts(): BlogPost[] {
  const cmsPosts = loadCmsStore().blog;
  if (cmsPosts.length) {
    const normalized = cmsPosts
      .map((item) =>
        normalizePost({
          ...item,
          coverImage: typeof item.coverImage === "string" ? item.coverImage : item.image,
          publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : item.date,
        }),
      )
      .filter((post): post is BlogPost => Boolean(post));
    if (normalized.length) return normalized;
  }
  return readStoredPosts() ?? DEFAULT_BLOG_POSTS;
}

export function saveBlogPosts(posts: BlogPost[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BLOG_STORAGE_KEY, JSON.stringify(posts));
  window.dispatchEvent(new Event("lunayairmarina-blog-posts"));
}

export function getPublishedPosts(posts = loadBlogPosts()) {
  return posts
    .filter((post) => post.status === "published")
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
}

export function getPostBySlug(slug: string, posts = loadBlogPosts()) {
  return posts.find((post) => post.slug === slug) ?? null;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function absoluteUrl(path: string) {
  return siteAbsoluteUrl(path);
}

export function buildArticleJsonLd(post: BlogPost, language: Language = "en") {
  const url = absoluteUrl(`/blog/${post.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: tx(post.seoTitle, language) || tx(post.title, language),
    description: tx(post.seoDescription, language) || tx(post.excerpt, language),
    image: [post.coverImage],
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: {
      "@type": "Person",
      name: tx(post.author, language),
    },
    publisher: {
      "@type": "Organization",
      name: "lunayairmarina",
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/images/brand/logo.png"),
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    keywords: [tx(post.focusKeyword, language), ...post.tags.map((tag) => tx(tag, language))]
      .filter(Boolean)
      .join(", "),
  };
}

export function buildBlogListJsonLd(posts: BlogPost[], language: Language = "en") {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "lunayairmarina Blog",
    description:
      language === "ar"
        ? "أدلة متخصصة في إدارة اليخوت وعمليات المارينا والإبحار في البحر الأحمر من lunayairmarina."
        : "Expert guides on yacht management, marina operations and Red Sea yachting from lunayairmarina.",
    url: absoluteUrl("/blog"),
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: tx(post.title, language),
      url: absoluteUrl(`/blog/${post.slug}`),
      datePublished: post.publishedAt,
      description: tx(post.excerpt, language),
    })),
  };
}

export function newBlockId() {
  return `blk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
