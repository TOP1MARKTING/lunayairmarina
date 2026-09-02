/**
 * Start Firebase emulators with local credentials.
 * Uses auth + firestore when Java is available; otherwise functions + auth only.
 *
 * PowerShell note: if you run `firebase emulators:start` directly, quote the
 * --only value or commas become separate arguments:
 *   firebase emulators:start --only "auth,firestore,functions"
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });
loadEnv({ path: resolve(root, "functions/.secret.local") });

process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

/** Ensure `java` is on PATH when JAVA_HOME is set (common on Windows). */
function ensureJavaOnPath() {
  const javaHome = process.env.JAVA_HOME?.trim();
  if (!javaHome) return;
  const bin = resolve(javaHome, "bin");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const current = process.env[pathKey] ?? "";
  if (!current.split(";").includes(bin)) {
    process.env[pathKey] = `${bin};${current}`;
  }
}

function hasJava() {
  ensureJavaOnPath();
  const result = spawnSync("java", ["-version"], { shell: true, stdio: "ignore" });
  return result.status === 0;
}

const javaAvailable = hasJava();
if (javaAvailable) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
} else {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  console.warn(
    "[emulator] Java not found — Firestore emulator disabled; admin role docs use project Firestore",
  );
}

function absolutizeCredentialPath(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return false;
  const abs = isAbsolute(raw) ? raw : resolve(root, raw);
  if (!existsSync(abs)) return false;
  process.env[name] = abs;
  return true;
}

if (absolutizeCredentialPath("FIREBASE_SERVICE_ACCOUNT_PATH")) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
} else if (absolutizeCredentialPath("GOOGLE_APPLICATION_CREDENTIALS")) {
  // keep explicit GAC when set
}

console.log("[emulator] OPENAI_API_KEY:", process.env.OPENAI_API_KEY?.trim() ? "loaded" : "missing");
console.log("[emulator] FIREBASE_AUTH_EMULATOR_HOST:", process.env.FIREBASE_AUTH_EMULATOR_HOST);
console.log(
  "[emulator] FIRESTORE_EMULATOR_HOST:",
  process.env.FIRESTORE_EMULATOR_HOST ?? "(not set — project Firestore)",
);

const emulators = javaAvailable
  ? "functions,auth,firestore"
  : "functions,auth";

const child = spawn("firebase", ["emulators:start", `--only`, emulators], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
