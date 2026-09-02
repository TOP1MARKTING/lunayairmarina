/**
 * Admin dashboard audit — infrastructure + API reachability checks.
 *
 * Does NOT mutate production data. Probes server-fn endpoints with dummy tokens
 * and verifies static hosting wiring (www proxy vs direct Vercel).
 *
 * Usage:
 *   npx tsx scripts/test-admin-audit.ts
 *   npx tsx scripts/test-admin-audit.ts --live   # also probe www + vercel origins
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";
import { decodeServerFnResponse, encodeServerFnPayload } from "../src/lib/api/serovalCodec";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");

type Status = "pass" | "fail" | "warn" | "skip";

type CheckResult = {
  area: string;
  action: string;
  transport: string;
  status: Status;
  detail: string;
};

const results: CheckResult[] = [];

function record(
  area: string,
  action: string,
  transport: string,
  status: Status,
  detail: string,
) {
  results.push({ area, action, transport, status, detail });
}

async function probeServerFn(
  baseUrl: string,
  fnName: keyof typeof TANSTACK_SERVER_FUNCTION_IDS,
  origin: string,
): Promise<{ ok: boolean; detail: string }> {
  const id = TANSTACK_SERVER_FUNCTION_IDS[fnName];
  const url = `${baseUrl.replace(/\/$/, "")}/_serverFn/${id}`;
  const isWww = baseUrl.includes("www.lunayairmarina.com");

  try {
    if (!isWww) {
      const preflight = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,authorization,x-tsr-serverfn",
        },
      });
      const acao = preflight.headers.get("access-control-allow-origin") ?? "";
      if (preflight.status !== 204 && preflight.status !== 200) {
        return { ok: false, detail: `CORS preflight HTTP ${preflight.status}` };
      }
      if (acao !== origin) {
        return { ok: false, detail: `CORS ACAO mismatch (got ${acao || "none"})` };
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin,
        "x-tsr-serverFn": "true",
      },
      body: encodeServerFnPayload({ idToken: "audit-dummy-token" }),
    });
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      return {
        ok: false,
        detail: "returns HTML — .htaccess proxy missing or mod_proxy disabled on cPanel",
      };
    }
    if (!ct.includes("application/json")) {
      return { ok: false, detail: `unexpected content-type: ${ct || "none"}` };
    }

    const raw = await response.json();
    let result: { ok?: boolean; error?: string } | null = null;
    try {
      result = decodeServerFnResponse(raw) as { ok?: boolean; error?: string } | null;
    } catch (error) {
      return {
        ok: false,
        detail: `decode failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (response.status >= 500) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }

    // Dummy token should be denied, not crash — proves endpoint is wired.
    if (result?.ok === false && (result.error === "UNAUTHORIZED" || result.error === "FORBIDDEN")) {
      return { ok: true, detail: `HTTP ${response.status} auth gate OK (${result.error})` };
    }
    if (result?.ok === false && result.error?.includes("jose")) {
      return {
        ok: false,
        detail: "Vercel auth broken (jose/jwks-rsa ESM) — server-fn admin ops fail even with valid token",
      };
    }
    if (result?.ok === true) {
      return { ok: true, detail: `HTTP ${response.status} allowed (unexpected for dummy token)` };
    }
    return {
      ok: true,
      detail: `HTTP ${response.status} JSON reachable (${result?.error ?? "no error field"})`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkDistHtaccess() {
  const htaccessPath = resolve(root, "dist", ".htaccess");
  if (!existsSync(htaccessPath)) {
    record("Infrastructure", "dist/.htaccess", "file", "warn", "missing — run npm run build:static");
    return;
  }
  const content = readFileSync(htaccessPath, "utf8");
  const hasProxy = content.includes("_serverFn") && content.includes("[P,L]");
  const hasVercel = content.includes("lunayairmarina.vercel.app");
  if (hasProxy && hasVercel) {
    record(
      "Infrastructure",
      "dist/.htaccess proxy rule",
      "Apache",
      "pass",
      "contains /_serverFn → Vercel [P,L]",
    );
  } else {
    record(
      "Infrastructure",
      "dist/.htaccess proxy rule",
      "Apache",
      "fail",
      "missing _serverFn proxy to Vercel",
    );
  }
}

function checkServerFnIdsInDist() {
  const assetsDir = resolve(root, "dist", "assets");
  if (!existsSync(assetsDir)) {
    record("Infrastructure", "server-fn IDs in dist", "bundle", "skip", "no dist/assets");
    return;
  }
  let bundled = "";
  for (const file of readdirSync(assetsDir)) {
    if (String(file).endsWith(".js")) {
      bundled += readFileSync(resolve(assetsDir, file), "utf8");
    }
  }
  const missing = Object.entries(TANSTACK_SERVER_FUNCTION_IDS).filter(([, id]) => !bundled.includes(id));
  if (missing.length) {
    record(
      "Infrastructure",
      "server-fn IDs in dist",
      "bundle",
      "fail",
      `missing: ${missing.map(([n]) => n).join(", ")}`,
    );
  } else {
    record(
      "Infrastructure",
      "server-fn IDs in dist",
      "bundle",
      "pass",
      `all ${Object.keys(TANSTACK_SERVER_FUNCTION_IDS).length} IDs present`,
    );
  }
}

const ADMIN_SERVER_FNS: Array<{
  fn: keyof typeof TANSTACK_SERVER_FUNCTION_IDS;
  area: string;
  action: string;
}> = [
  { fn: "aiTriggerKnowledgeSync", area: "AI", action: "مزامنة المعرفة / Sync knowledge" },
  { fn: "aiDeleteConversation", area: "AI", action: "حذف محادثة / Delete conversation" },
  { fn: "aiDeleteAllConversations", area: "AI", action: "مسح كل المحادثات / Delete all" },
  { fn: "adminSetUserPassword", area: "Users", action: "تعيين كلمة مرور / Set password" },
];

const CMS_CLIENT_ACTIONS: Array<{ area: string; action: string; collection: string }> = [
  { area: "Content", action: "حفظ النصوص / Save copy", collection: "copy, homepage, about" },
  { area: "Services", action: "إضافة/تعديل/حذف خدمة", collection: "services" },
  { area: "Why", action: "حفظ أسباب الثقة", collection: "why/main" },
  { area: "Trust", action: "حفظ شرائح الثقة", collection: "trust/main" },
  { area: "Team", action: "إضافة/حذف عضو", collection: "team" },
  { area: "Blog", action: "إضافة/حذف مقال", collection: "blog" },
  { area: "Gallery", action: "رفع/حذف صورة", collection: "gallery, media" },
  { area: "Testimonials", action: "إضافة/حذف شهادة", collection: "testimonials" },
  { area: "FAQ", action: "إضافة/حذف سؤال", collection: "faq" },
  { area: "Ads", action: "إضافة/حذف/تفعيل إعلان", collection: "advertisements" },
  { area: "Messages", action: "قراءة/حذف رسالة", collection: "messages" },
  { area: "SEO", action: "حفظ SEO", collection: "seo, pageHeaders" },
  { area: "Settings", action: "حفظ الإعدادات", collection: "settings/general" },
  { area: "Users", action: "إضافة/تعديل/حذف مستخدم", collection: "admins" },
];

async function main() {
  console.log("[admin-audit] Admin dashboard audit\n");

  checkDistHtaccess();
  checkServerFnIdsInDist();

  for (const item of CMS_CLIENT_ACTIONS) {
    record(
      item.area,
      item.action,
      "Firestore client",
      "skip",
      `requires signed-in admin — writes ${item.collection}`,
    );
  }

  record("Auth", "تسجيل الدخول / Login", "Firebase Auth", "skip", "manual — needs credentials");
  record("Auth", "تسجيل الخروج / Logout", "Firebase Auth", "skip", "client-only");
  record("Dashboard", "عرض الإحصائيات / KPIs", "cms-store + Firestore read", "skip", "read-only");

  if (!live) {
    console.log("[admin-audit] Pass --live to probe www + Vercel endpoints\n");
  } else {
    const www = "https://www.lunayairmarina.com";
    const vercel = "https://lunayairmarina.vercel.app";
    const origin = www;

    for (const item of ADMIN_SERVER_FNS) {
      const wwwProbe = await probeServerFn(www, item.fn, origin);
      record(
        item.area,
        `${item.action} (www)`,
        "server-fn",
        wwwProbe.ok ? "pass" : "fail",
        wwwProbe.detail,
      );

      const vercelProbe = await probeServerFn(vercel, item.fn, origin);
      record(
        item.area,
        `${item.action} (Vercel)`,
        "server-fn",
        vercelProbe.ok ? "pass" : "fail",
        vercelProbe.detail,
      );
    }
  }

  const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of results) counts[r.status]++;

  console.log("| Status | Area | Action | Transport | Detail |");
  console.log("|--------|------|--------|-----------|--------|");
  for (const r of results) {
    const icon =
      r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : r.status === "warn" ? "⚠️" : "⏭️";
    console.log(`| ${icon} ${r.status} | ${r.area} | ${r.action} | ${r.transport} | ${r.detail} |`);
  }

  console.log(
    `\n[admin-audit] Summary: ${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn, ${counts.skip} skipped`,
  );

  if (counts.fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
