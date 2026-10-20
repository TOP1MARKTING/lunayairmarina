/**
 * Set OPENAI_API_KEY as a Firebase Functions secret from local .env (never prints the value).
 * Requires Blaze plan.
 *
 * Usage: npx tsx scripts/push-firebase-openai-secret.ts
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: resolve(root, ".env") });

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
if (!key) {
  console.error("FAIL: OPENAI_API_KEY missing in .env");
  process.exit(1);
}

const result = spawnSync(
  "firebase",
  ["functions:secrets:set", "OPENAI_API_KEY", "--project", "lunayairmarina-2d694"],
  {
    input: key,
    encoding: "utf8",
    shell: true,
    cwd: root,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  console.error(
    "FAIL: could not set secret. If the project is on Spark, upgrade to Blaze first:\n" +
      "https://console.firebase.google.com/project/lunayairmarina-2d694/usage/details",
  );
  process.exit(result.status ?? 1);
}

console.log("OK: OPENAI_API_KEY secret configured (length hidden)");
