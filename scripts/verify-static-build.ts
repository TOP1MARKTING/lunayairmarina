/**
 * Post-build checks for the Apache/cPanel static artifact in dist/.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listStaticPrerenderPaths } from "./staticPrerenderRoutes";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

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

const forbiddenSnippets = ["GEMINI_API_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON", "private_key"];
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

console.log("[verify-static-build] all checks passed");
