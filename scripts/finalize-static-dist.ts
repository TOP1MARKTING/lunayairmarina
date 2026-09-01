/**
 * Flatten TanStack Start static output (dist/client) into dist/ for Apache upload.
 * Removes build-only server artifacts from dist/.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const clientDir = resolve(dist, "client");
const serverDir = resolve(dist, "server");
const stagingDir = resolve(dist, ".client-staging");

function fail(message: string): never {
  console.error(`[finalize-static-dist] FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(clientDir)) {
  fail("dist/client is missing — static client build did not complete");
}

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true, force: true });
}
mkdirSync(stagingDir, { recursive: true });

for (const entry of readdirSync(clientDir)) {
  cpSync(join(clientDir, entry), join(stagingDir, entry), { recursive: true });
}

if (existsSync(serverDir)) {
  rmSync(serverDir, { recursive: true, force: true });
}
rmSync(clientDir, { recursive: true, force: true });

for (const entry of readdirSync(stagingDir)) {
  const from = join(stagingDir, entry);
  const to = join(dist, entry);
  if (existsSync(to)) {
    rmSync(to, { recursive: true, force: true });
  }
  cpSync(from, to, { recursive: true });
}
rmSync(stagingDir, { recursive: true, force: true });

if (!existsSync(resolve(dist, "index.html"))) {
  fail("dist/index.html missing after flattening dist/client");
}

const assetDir = resolve(dist, "assets");
if (!existsSync(assetDir) || !readdirSync(assetDir).some((f) => statSync(join(assetDir, f)).isFile())) {
  fail("dist/assets is missing or empty after flattening");
}

console.log("[finalize-static-dist] flattened dist/client -> dist/");
