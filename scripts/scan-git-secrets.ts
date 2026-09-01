/**
 * Scan git diff for secret-like material.
 * Allows the public Firebase Web API key in known client config files only.
 */
import { execSync } from "node:child_process";
import { PUBLIC_WEB_FALLBACK } from "../src/lib/firebaseConfig";

export type SecretFinding = {
  rule: string;
  file: string;
  line: string;
  classification: "secret" | "allowed_public_firebase_web_key";
};

/** Files where an AIza… Firebase Web API key is expected public client configuration. */
export const ALLOWED_PUBLIC_FIREBASE_WEB_KEY_FILES = new Set([
  "src/lib/firebaseConfig.ts",
  "src/lib/firebase.ts",
]);

const PUBLIC_FIREBASE_WEB_API_KEY = PUBLIC_WEB_FALLBACK.apiKey;

type SecretRule = {
  id: string;
  pattern: RegExp;
  /** When true, AIza matches are checked against the public Firebase web key allowlist. */
  allowPublicFirebaseWebKey?: boolean;
};

const SECRET_RULES: SecretRule[] = [
  { id: "gemini_api_key_assignment", pattern: /GEMINI_API_KEY\s*=\s*\S+/ },
  { id: "gemini_api_key_json", pattern: /"GEMINI_API_KEY"\s*:\s*"[^"]+"/ },
  { id: "private_key_field", pattern: /"private_key"\s*:\s*"/ },
  { id: "private_key_pem", pattern: /BEGIN PRIVATE KEY/ },
  {
    id: "service_account_client_email",
    pattern: /"client_email"\s*:\s*"[^"]+@[^"]+\.iam\.gserviceaccount\.com"/,
  },
  { id: "firebase_service_account_json", pattern: /FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*\S+/ },
  { id: "oauth_client_secret", pattern: /client_secret\s*=\s*\S+/i },
  { id: "google_api_key_assignment", pattern: /GOOGLE_API_KEY\s*=\s*\S+/i },
  {
    id: "google_api_key_like",
    pattern: /AIza[0-9A-Za-z_-]{20,}/,
    allowPublicFirebaseWebKey: true,
  },
];

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^(a|b)\//, "");
}

function isAllowedPublicFirebaseWebKeyLine(file: string, line: string): boolean {
  const normalized = normalizePath(file);
  if (!ALLOWED_PUBLIC_FIREBASE_WEB_KEY_FILES.has(normalized)) return false;
  return (
    line.includes(PUBLIC_FIREBASE_WEB_API_KEY) ||
    /apiKey\s*:\s*["']AIza/.test(line) ||
    /VITE_FIREBASE_API_KEY/.test(line) ||
    /PUBLIC_WEB_FALLBACK/.test(line) ||
    /readEnv\(["']VITE_FIREBASE_API_KEY["']\)/.test(line)
  );
}

export function scanDiffText(diff: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  let currentFile = "";

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ b/")) {
      currentFile = rawLine.slice("+++ b/".length);
      continue;
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;

    const line = rawLine.slice(1);
    for (const rule of SECRET_RULES) {
      if (!rule.pattern.test(line)) continue;

      if (rule.allowPublicFirebaseWebKey && isAllowedPublicFirebaseWebKeyLine(currentFile, line)) {
        findings.push({
          rule: rule.id,
          file: currentFile,
          line: line.trim(),
          classification: "allowed_public_firebase_web_key",
        });
        continue;
      }

      findings.push({
        rule: rule.id,
        file: currentFile,
        line: line.trim(),
        classification: "secret",
      });
    }
  }

  return findings;
}

function readGitDiff(): string {
  try {
    return (
      execSync("git diff --no-color HEAD", { encoding: "utf8" }) +
      execSync("git diff --cached --no-color HEAD", { encoding: "utf8" })
    );
  } catch {
    return "";
  }
}

function runSelfChecks(): boolean {
  let ok = true;

  const allowedDiff = [
    "+++ b/src/lib/firebaseConfig.ts",
    `+  apiKey: "${PUBLIC_FIREBASE_WEB_API_KEY}",`,
  ].join("\n");
  const allowed = scanDiffText(allowedDiff).filter((f) => f.classification === "secret");
  if (allowed.length !== 0) {
    console.error("[scan:secrets] self-check failed: public Firebase key should be allowed");
    ok = false;
  } else {
    console.log("[scan:secrets] self-check OK: public Firebase web API key allowed");
  }

  const secretDiff = [
    "+++ b/.env",
    "+GEMINI_API_KEY=super-secret-gemini-value",
  ].join("\n");
  const secret = scanDiffText(secretDiff).filter((f) => f.classification === "secret");
  if (secret.length === 0) {
    console.error("[scan:secrets] self-check failed: GEMINI_API_KEY assignment should fail");
    ok = false;
  } else {
    console.log("[scan:secrets] self-check OK: GEMINI_API_KEY assignment detected");
  }

  const strayDiff = [
    "+++ b/src/hack.ts",
    `+const key = "${PUBLIC_FIREBASE_WEB_API_KEY}";`,
  ].join("\n");
  const stray = scanDiffText(strayDiff).filter((f) => f.classification === "secret");
  if (stray.length === 0) {
    console.error("[scan:secrets] self-check failed: stray AIza key outside allowlist should fail");
    ok = false;
  } else {
    console.log("[scan:secrets] self-check OK: stray AIza key rejected");
  }

  return ok;
}

function main() {
  const selfOk = runSelfChecks();
  const diff = readGitDiff();
  const findings = scanDiffText(diff);
  const allowed = findings.filter((f) => f.classification === "allowed_public_firebase_web_key");
  const secrets = findings.filter((f) => f.classification === "secret");

  for (const item of allowed) {
    console.log(
      `ALLOWED ${item.rule} in ${item.file} (public Firebase Web API key)`,
    );
  }

  if (secrets.length) {
    console.error(`SECURITY_FAIL ${secrets.length} secret-like addition(s) in git diff:`);
    for (const item of secrets) {
      console.error(` - [${item.rule}] ${item.file}: ${item.line.slice(0, 120)}`);
    }
    process.exit(selfOk ? 1 : 1);
  }

  console.log("git_diff_secret_scan: clean");
  if (!selfOk) process.exit(1);
}

main();
