/**
 * Static Apache/cPanel production build.
 *
 * Architecture (default — works today):
 *   cPanel (static dist/) → Vercel server-fn → OpenAI + Firestore
 *
 * Optional Firebase CF:
 *   VITE_API_TRANSPORT=http (requires Blaze + deployed functions)
 *
 * Set VITE_SITE_URL to the cPanel canonical origin before building.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const transport = process.env.VITE_API_TRANSPORT?.trim() || "server-fn";
process.env.VITE_API_TRANSPORT = transport;
process.env.VITE_STATIC_HOSTING = "true";

if (!process.env.VITE_SITE_URL?.trim()) {
  process.env.VITE_SITE_URL = "https://www.lunayairmarina.com";
}

const functionsBase = (
  process.env.VITE_FUNCTIONS_BASE_URL?.trim() ||
  "https://us-central1-lunayairmarina-2d694.cloudfunctions.net"
).replace(/\/$/, "");

if (transport === "http") {
  process.env.VITE_FUNCTIONS_BASE_URL = functionsBase;
  if (!process.env.VITE_API_BASE_URL?.trim()) {
    process.env.VITE_API_BASE_URL = process.env.VITE_SITE_URL.replace(/\/$/, "");
  }
  delete process.env.VITE_TSS_SERVER_FN_BASE;
} else {
  const apiBase = (
    process.env.VITE_API_BASE_URL?.trim() || "https://lunayairmarina.vercel.app"
  ).replace(/\/$/, "");
  process.env.VITE_API_BASE_URL = apiBase;
  process.env.VITE_TSS_SERVER_FN_BASE = `${apiBase}/_serverFn/`;
  if (!process.env.VITE_VERCEL_API_ORIGIN?.trim()) {
    process.env.VITE_VERCEL_API_ORIGIN = apiBase;
  }
  delete process.env.VITE_FUNCTIONS_BASE_URL;
}

console.log("[build:static] VITE_API_TRANSPORT=", process.env.VITE_API_TRANSPORT);
console.log("[build:static] VITE_API_BASE_URL=", process.env.VITE_API_BASE_URL);
console.log("[build:static] VITE_FUNCTIONS_BASE_URL=", process.env.VITE_FUNCTIONS_BASE_URL ?? "(unset)");
console.log("[build:static] VITE_TSS_SERVER_FN_BASE=", process.env.VITE_TSS_SERVER_FN_BASE ?? "(unset)");
console.log("[build:static] VITE_SITE_URL=", process.env.VITE_SITE_URL);

if (transport === "http") {
  console.log(
    "[build:static] Firebase Cloud Functions transport — requires Blaze + deployed functions.",
  );
}

const ssrAssets = resolve(root, ".output/public/assets");
if (!existsSync(ssrAssets) && transport === "server-fn") {
  console.log("[build:static] SSR build missing — running npm run build to verify server-fn IDs…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

if (transport === "server-fn") {
  execSync("tsx scripts/verify-server-fn-ids.ts", { cwd: root, stdio: "inherit" });
}
execSync("tsx scripts/generateSitemap.ts", { cwd: root, stdio: "inherit" });
execSync("vite build --config vite.config.static.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/finalize-static-dist.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/generate-htaccess.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/verify-static-build.ts", { cwd: root, stdio: "inherit" });
execSync("tsx scripts/package-cpanel.ts", { cwd: root, stdio: "inherit" });

console.log("[build:static] done — upload dist/ to cPanel public_html/");
