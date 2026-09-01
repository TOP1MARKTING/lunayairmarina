/**
 * Static Apache/cPanel production build.
 * Sets client env for HTTP API transport before invoking Vite.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.env.VITE_API_TRANSPORT = process.env.VITE_API_TRANSPORT?.trim() || "http";
process.env.VITE_STATIC_HOSTING = "true";
if (!process.env.VITE_FUNCTIONS_BASE_URL?.trim()) {
  process.env.VITE_FUNCTIONS_BASE_URL =
    "https://us-central1-lunayairmarina-2d694.cloudfunctions.net";
}
if (!process.env.VITE_API_BASE_URL?.trim()) {
  process.env.VITE_API_BASE_URL = "https://www.lunayairmarina.com";
}
if (!process.env.VITE_SITE_URL?.trim()) {
  process.env.VITE_SITE_URL = "https://www.lunayairmarina.com";
}

console.log("[build:static] VITE_API_TRANSPORT=", process.env.VITE_API_TRANSPORT);
console.log("[build:static] VITE_FUNCTIONS_BASE_URL=", process.env.VITE_FUNCTIONS_BASE_URL);
console.log("[build:static] VITE_API_BASE_URL=", process.env.VITE_API_BASE_URL);
console.log("[build:static] VITE_SITE_URL=", process.env.VITE_SITE_URL);

if (process.env.VITE_API_TRANSPORT === "http") {
  console.warn(
    "[build:static] WARNING: http transport requires deployed Firebase Cloud Functions " +
      "(Blaze plan). On the Spark plan use the Vercel SSR build (npm run build) instead.",
  );
}

execSync("tsx scripts/generateSitemap.ts", { cwd: root, stdio: "inherit" });
execSync("vite build --config vite.config.static.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/finalize-static-dist.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/verify-static-build.ts", { cwd: root, stdio: "inherit" });

console.log("[build:static] done");
