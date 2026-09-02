/**
 * Sync OPENAI_API_KEY from local .env to Vercel Production (never prints the value).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: resolve(root, ".env") });

const API = "https://api.vercel.com";
const PROJECT_ID = "prj_OgTifkTkSrdpWBuknCSnyTQ2nWII";
const TEAM_ID = "team_pxUwy8pqDwUJerY2DBU3byJK";

function readVercelToken(): string {
  const candidates = [
    resolve(homedir(), "AppData/Roaming/xdg.data/com.vercel.cli/auth.json"),
    resolve(homedir(), "AppData/Roaming/com.vercel.cli/Data/auth.json"),
    resolve(homedir(), ".vercel/auth.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { token?: string };
    if (parsed.token?.trim()) return parsed.token.trim();
  }
  throw new Error("Vercel auth token not found");
}

async function api(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error?: { message?: string } }).error?.message ?? res.status)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function removeEnvKeys(token: string, keys: string[]) {
  const q = `?teamId=${TEAM_ID}`;
  const existing = (
    (await api(token, `/v9/projects/${PROJECT_ID}/env${q}`)) as {
      envs?: Array<{ id: string; key: string }>;
    }
  ).envs?.filter((e) => keys.includes(e.key)) ?? [];

  for (const env of existing) {
    await api(token, `/v9/projects/${PROJECT_ID}/env/${env.id}${q}`, { method: "DELETE" });
    console.log(`removed_old_env key=${env.key} id=${env.id}`);
  }
}

async function main() {
  const value = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!value) {
    console.error("FAIL: OPENAI_API_KEY missing in .env");
    process.exit(1);
  }

  const token = readVercelToken();
  const q = `?teamId=${TEAM_ID}`;

  await removeEnvKeys(token, ["GEMINI_API_KEY"]);

  await removeEnvKeys(token, ["OPENAI_API_KEY"]);

  await api(token, `/v9/projects/${PROJECT_ID}/env${q}`, {
    method: "POST",
    body: JSON.stringify({
      key: "OPENAI_API_KEY",
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
  });
  console.log("upsert_env key=OPENAI_API_KEY targets=production,preview,development configured=yes");
}

main().catch((error) => {
  console.error(`FAIL=${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`);
  process.exit(1);
});
