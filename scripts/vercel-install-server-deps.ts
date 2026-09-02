/**
 * Ensures firebase-admin is available inside the Vercel server function output.
 * Nitro keeps firebase-admin external (bundling breaks SDK_VERSION), so runtime
 * must resolve it from node_modules inside __server.func.
 *
 * Runs only on Vercel builds (VERCEL=1).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (!process.env.VERCEL) {
  console.log("[vercel-server-deps] skip (not a Vercel build)");
  process.exit(0);
}

const funcDir = resolve(".vercel/output/functions/__server.func");
if (!existsSync(funcDir)) {
  console.log("[vercel-server-deps] skip (no __server.func output)");
  process.exit(0);
}

const rootPkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const firebaseAdminVersion =
  rootPkg.dependencies?.["firebase-admin"] ?? rootPkg.devDependencies?.["firebase-admin"] ?? "^14.3.0";

const pkg = {
  name: "lunayair-server-func",
  private: true,
  type: "module",
  dependencies: {
    "firebase-admin": firebaseAdminVersion,
  },
  // jwks-rsa@4 pulls jose@6 (ESM-only); Vercel CJS runtime cannot require() it.
  overrides: {
    jwks-rsa: "3.2.0",
    jose: "4.15.9",
  },
};

writeFileSync(resolve(funcDir, "package.json"), JSON.stringify(pkg, null, 2));
console.log("[vercel-server-deps] installing firebase-admin in", funcDir);

execSync("npm install --omit=dev --no-audit --no-fund", {
  cwd: funcDir,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

console.log("[vercel-server-deps] done");
