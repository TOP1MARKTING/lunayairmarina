/**
 * Ensure TANSTACK_SERVER_FUNCTION_IDS in endpoints.ts match the latest SSR build.
 * Run after `npm run build` (populates .output/public/assets).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(root, ".output/public/assets");

function fail(message: string): never {
  console.error(`[verify-server-fn-ids] FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(assetsDir)) {
  fail(
    ".output/public/assets is missing — run `npm run build` first so server-function IDs can be verified.",
  );
}

let bundled = "";
for (const file of readdirSync(assetsDir)) {
  if (file.endsWith(".js")) {
    bundled += readFileSync(resolve(assetsDir, file), "utf8");
  }
}

const stale = Object.entries(TANSTACK_SERVER_FUNCTION_IDS).filter(([, id]) => !bundled.includes(id));

if (stale.length) {
  fail(
    `Stale server function IDs in src/lib/api/endpoints.ts: ${stale
      .map(([name]) => name)
      .join(", ")}. Run \`npm run build\`, update TANSTACK_SERVER_FUNCTION_IDS from .output/public/assets, then rebuild static.`,
  );
}

console.log(
  `[verify-server-fn-ids] OK: all ${Object.keys(TANSTACK_SERVER_FUNCTION_IDS).length} IDs match SSR build`,
);
