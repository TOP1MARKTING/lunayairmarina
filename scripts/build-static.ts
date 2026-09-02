/**
 * Static Apache/cPanel production build.
 *
 * Architecture:
 *   cPanel (static dist/) → Vercel free tier (TanStack server functions) → Firebase Spark + Gemini
 *
 * Set VITE_SITE_URL to the client's cPanel canonical origin before building.
 * Set VITE_API_BASE_URL to the Vercel backend origin (defaults to lunayairmarina.vercel.app).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const apiBase = (
  process.env.VITE_API_BASE_URL?.trim() || "https://lunayairmarina.vercel.app"
).replace(/\/$/, "");

process.env.VITE_API_TRANSPORT = process.env.VITE_API_TRANSPORT?.trim() || "server-fn";
process.env.VITE_STATIC_HOSTING = "true";
process.env.VITE_TSS_SERVER_FN_BASE = `${apiBase}/_serverFn/`;

if (!process.env.VITE_API_BASE_URL?.trim()) {
  process.env.VITE_API_BASE_URL = apiBase;
}
if (!process.env.VITE_SITE_URL?.trim()) {
  process.env.VITE_SITE_URL = "https://www.lunayairmarina.com";
}

// Cloud Functions transport is not used on Spark; do not inject a CF base URL.
delete process.env.VITE_FUNCTIONS_BASE_URL;

console.log("[build:static] VITE_API_TRANSPORT=", process.env.VITE_API_TRANSPORT);
console.log("[build:static] VITE_API_BASE_URL=", process.env.VITE_API_BASE_URL);
console.log("[build:static] VITE_TSS_SERVER_FN_BASE=", process.env.VITE_TSS_SERVER_FN_BASE);
console.log("[build:static] VITE_SITE_URL=", process.env.VITE_SITE_URL);

if (process.env.VITE_API_TRANSPORT === "http") {
  console.warn(
    "[build:static] WARNING: http transport targets Firebase Cloud Functions and requires Blaze. " +
      "Use server-fn (default) for cPanel + Vercel free tier.",
  );
}

const ssrAssets = resolve(root, ".output/public/assets");
if (!existsSync(ssrAssets)) {
  console.log("[build:static] SSR build missing — running npm run build to verify server-fn IDs…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

execSync("tsx scripts/verify-server-fn-ids.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/generateSitemap.ts", { cwd: root, stdio: "inherit" });
execSync("vite build --config vite.config.static.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/finalize-static-dist.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/generate-htaccess.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/verify-static-build.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/package-cpanel.ts", { cwd: root, stdio: "inherit" });

console.log("[build:static] done — upload dist/ to cPanel public_html/");
