/**
 * Public routes to prerender for the Apache/cPanel static build.
 * Keep in sync with src/lib/sitemap.ts.
 */
import {
  listPublicSitemapEntries,
  normalizePublicPath,
} from "../src/lib/sitemap";

/** Extra index routes that exist in the router but use trailing-slash paths. */
const EXTRA_PRERENDER_PATHS = ["/services/", "/blog/"] as const;

export function listStaticPrerenderPaths(): string[] {
  const fromSitemap = listPublicSitemapEntries().map((entry) =>
    normalizePublicPath(entry.path),
  );
  const merged = [...fromSitemap, ...EXTRA_PRERENDER_PATHS];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of merged) {
    if (seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}
