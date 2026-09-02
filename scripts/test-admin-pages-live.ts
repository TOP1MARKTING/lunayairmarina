/**
 * Smoke-test admin routes load on production (no login required).
 */
const BASE = process.env.ADMIN_AUDIT_URL?.trim() || "https://www.lunayairmarina.com";

const ADMIN_ROUTES = [
  "/admin/login",
  "/admin/dashboard",
  "/admin/content",
  "/admin/services",
  "/admin/why",
  "/admin/trust",
  "/admin/team",
  "/admin/blog",
  "/admin/gallery",
  "/admin/testimonials",
  "/admin/faq",
  "/admin/advertisements",
  "/admin/messages",
  "/admin/ai",
  "/admin/seo",
  "/admin/users",
  "/admin/settings",
];

async function main() {
  console.log(`[admin-pages] Probing ${BASE}\n`);
  let failed = 0;
  for (const route of ADMIN_ROUTES) {
    const url = `${BASE.replace(/\/$/, "")}${route}`;
    try {
      const res = await fetch(url, { redirect: "follow" });
      const ct = res.headers.get("content-type") ?? "";
      const ok = res.ok && ct.includes("text/html");
      const icon = ok ? "✅" : "❌";
      console.log(`${icon} ${route} → HTTP ${res.status} (${ct.split(";")[0]})`);
      if (!ok) failed++;
    } catch (error) {
      console.log(`❌ ${route} → ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }
  console.log(`\n[admin-pages] ${ADMIN_ROUTES.length - failed}/${ADMIN_ROUTES.length} routes OK`);
  if (failed) process.exit(1);
}

main();
