/**
 * Post-build checks for the Apache/cPanel static artifact in dist/.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listStaticPrerenderPaths } from "./staticPrerenderRoutes";
import { TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const apiBase = (
  process.env.VITE_API_BASE_URL?.trim() || "https://lunayairmarina.vercel.app"
).replace(/\/$/, "");

function fail(message: string): never {
  console.error(`[verify-static-build] FAIL: ${message}`);
  process.exit(1);
}

function ok(message: string) {
  console.log(`[verify-static-build] OK: ${message}`);
}

if (!existsSync(dist)) {
  fail("dist/ directory is missing");
}

const indexHtml = resolve(dist, "index.html");
if (!existsSync(indexHtml)) {
  fail("dist/index.html is missing");
}
ok("dist/index.html exists");

const indexContent = readFileSync(indexHtml, "utf8");
if (!indexContent.includes("<div")) {
  fail("dist/index.html does not look like rendered HTML");
}

const assetsDir = resolve(dist, "assets");
if (!existsSync(assetsDir)) {
  fail("dist/assets/ is missing");
}
const assetFiles = readdirSync(assetsDir).filter((name) => statSync(join(assetsDir, name)).isFile());
if (!assetFiles.length) {
  fail("dist/assets/ has no files");
}
ok(`dist/assets/ contains ${assetFiles.length} files`);

for (const required of ["robots.txt", "sitemap.xml", "sitemap-index.xml", ".htaccess"]) {
  const filePath = resolve(dist, required);
  if (!existsSync(filePath)) {
    fail(`dist/${required} is missing`);
  }
  ok(`dist/${required} exists`);
}

for (const routePath of listStaticPrerenderPaths()) {
  if (routePath === "/") continue;
  const normalized = routePath.replace(/^\//, "");
  const candidates = [
    resolve(dist, normalized, "index.html"),
    resolve(dist, `${normalized}.html`),
  ];
  if (!candidates.some((candidate) => existsSync(candidate))) {
    fail(`prerendered HTML missing for route ${routePath}`);
  }
  ok(`prerender route ${routePath}`);
}

const forbiddenSnippets = ["OPENAI_API_KEY", "GEMINI_API_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON", "private_key"];
const sampleBundles = assetFiles
  .filter((name) => name.endsWith(".js"))
  .slice(0, 8)
  .map((name) => resolve(assetsDir, name));

for (const bundlePath of sampleBundles) {
  const content = readFileSync(bundlePath, "utf8");
  for (const snippet of forbiddenSnippets) {
    if (content.includes(snippet)) {
      fail(`secret-like string "${snippet}" found in ${bundlePath}`);
    }
  }
}
ok("sample client bundles contain no obvious server secrets");

let bundledJs = "";
for (const name of assetFiles.filter((n) => n.endsWith(".js"))) {
  bundledJs += readFileSync(resolve(assetsDir, name), "utf8");
}

if (bundledJs.includes("return`http`") || bundledJs.includes('return"http"')) {
  fail("static bundle still uses http API transport (Firebase Cloud Functions)");
}
ok("API transport is not http / Cloud Functions");

if (!bundledJs.includes("_serverFn")) {
  fail("static bundle does not reference TanStack server-fn endpoints");
}
ok("bundle references /_serverFn remote API");

if (!bundledJs.includes(apiBase.replace(/^https?:\/\//, ""))) {
  fail(`static bundle does not embed Vercel API base (${apiBase})`);
}
ok(`bundle targets Vercel API base ${apiBase}`);

if (bundledJs.includes("cloudfunctions.net")) {
  fail("static bundle still contains cloudfunctions.net — must use Vercel server-fn only");
}
ok("no Firebase Cloud Functions host in bundle");

for (const [name, id] of Object.entries(TANSTACK_SERVER_FUNCTION_IDS)) {
  if (!bundledJs.includes(id)) {
    fail(`server function ID missing for ${name}`);
  }
}
ok(`all ${Object.keys(TANSTACK_SERVER_FUNCTION_IDS).length} server-function IDs present`);

console.log("[verify-static-build] all checks passed");
