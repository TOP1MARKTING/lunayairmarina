/**
 * Post-build checks for the Apache/cPanel static artifact in dist/.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listStaticPrerenderPaths } from "./staticPrerenderRoutes";
import { FIREBASE_FUNCTION_NAMES, TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const transport = process.env.VITE_API_TRANSPORT?.trim() || "server-fn";
const functionsBase = (
  process.env.VITE_FUNCTIONS_BASE_URL?.trim() ||
  "https://us-central1-lunayairmarina-2d694.cloudfunctions.net"
).replace(/\/$/, "");
const apiBase = (
  process.env.VITE_API_BASE_URL?.trim() ||
  (transport === "http" ? "https://www.lunayairmarina.com" : "https://lunayairmarina.vercel.app")
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

if (transport === "http") {
  if (!bundledJs.includes("cloudfunctions.net") && !bundledJs.includes(functionsBase.replace(/^https?:\/\//, ""))) {
    fail(`static bundle does not embed Cloud Functions host (${functionsBase})`);
  }
  ok(`bundle targets Firebase Cloud Functions (${functionsBase})`);

  for (const name of Object.values(FIREBASE_FUNCTION_NAMES)) {
    if (!bundledJs.includes(name)) {
      fail(`Cloud Function name missing in bundle: ${name}`);
    }
  }
  ok(`all ${Object.keys(FIREBASE_FUNCTION_NAMES).length} Cloud Function names present`);

  if (bundledJs.includes("lunayairmarina.vercel.app/_serverFn")) {
    fail("http static bundle still hardcodes Vercel /_serverFn");
  }
  ok("bundle does not hardcode Vercel server-fn base");
} else {
  if (!bundledJs.includes("_serverFn")) {
    fail("static bundle does not reference TanStack server-fn endpoints");
  }
  ok("bundle references /_serverFn remote API");

  if (!bundledJs.includes(apiBase.replace(/^https?:\/\//, ""))) {
    fail(`static bundle does not embed API base (${apiBase})`);
  }
  ok(`bundle targets API base ${apiBase}`);

  if (bundledJs.includes("cloudfunctions.net")) {
    fail("server-fn static bundle still contains cloudfunctions.net");
  }
  ok("no Firebase Cloud Functions host in server-fn bundle");

  for (const [name, id] of Object.entries(TANSTACK_SERVER_FUNCTION_IDS)) {
    if (!bundledJs.includes(id)) {
      fail(`server function ID missing for ${name}`);
    }
  }
  ok(`all ${Object.keys(TANSTACK_SERVER_FUNCTION_IDS).length} server-function IDs present`);
}

console.log("[verify-static-build] all checks passed");
