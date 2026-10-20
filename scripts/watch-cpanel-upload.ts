/**
 * Monitor www.lunayairmarina.com while you upload dist/ to cPanel.
 * Detects when the new static build is live (Vercel API base in JS bundle).
 *
 * Usage: npx tsx scripts/watch-cpanel-upload.ts
 */
const SITE = "https://www.lunayairmarina.com";
const INTERVAL_MS = 15_000;
const MAX_ROUNDS = 120; // ~30 min

type Check = { name: string; ok: boolean; detail: string };

async function fetchText(url: string): Promise<{ status: number; text: string; ct: string }> {
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  const text = await res.text();
  return { status: res.status, text, ct: res.headers.get("content-type") ?? "" };
}

async function findMainBundle(): Promise<string | null> {
  const { text } = await fetchText(`${SITE}/`);
  const match = text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  return match ? `${SITE}${match[0]}` : null;
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const now = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  try {
    const home = await fetchText(`${SITE}/`);
    checks.push({
      name: "الصفحة الرئيسية",
      ok: home.status === 200,
      detail: `HTTP ${home.status}`,
    });

    const bundleUrl = await findMainBundle();
    if (!bundleUrl) {
      checks.push({ name: "البناء الجديد", ok: false, detail: "لم أجد index-*.js في HTML" });
    } else {
      const bundle = await fetchText(bundleUrl);
      const hasVercel = bundle.text.includes("lunayairmarina.vercel.app");
      checks.push({
        name: "البناء الجديد (Vercel API)",
        ok: hasVercel,
        detail: hasVercel ? "✓ البناء الجديد شغّال" : "⏳ لسه البناء القديم — كمّل الرفع",
      });
    }

    const admin = await fetchText(`${SITE}/admin/login`);
    checks.push({
      name: "لوحة الأدمن",
      ok: admin.status === 200,
      detail: `/admin/login → ${admin.status}`,
    });

    const htaccessProbe = await fetch(`${SITE}/.htaccess`, { method: "GET" }).catch(() => null);
    checks.push({
      name: ".htaccess",
      ok: htaccessProbe !== null && (htaccessProbe.status === 403 || htaccessProbe.status === 404),
      detail: htaccessProbe ? `HTTP ${htaccessProbe.status} (محمي — طبيعي)` : "لا استجابة",
    });

    const serverFnId = "a71ca7de25694d53eca41cc09cfde2d850cefbae693608e623eeb5fe184b3c53";
    const sf = await fetch(`${SITE}/_serverFn/${serverFnId}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: "{}",
    });
    const sfCt = sf.headers.get("content-type") ?? "";
    const sfOk = !sfCt.includes("text/html");
    checks.push({
      name: "/_serverFn proxy",
      ok: sfOk,
      detail: sfOk ? "JSON (proxy شغّال أو API مباشر)" : "HTML — .htaccess مش مرفوع صح",
    });
  } catch (error) {
    checks.push({
      name: "اتصال",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
}

function printBanner(round: number) {
  console.log("\n" + "═".repeat(56));
  console.log(`  مراقبة رفع cPanel — ${SITE}`);
  console.log(`  الجولة ${round}/${MAX_ROUNDS} — كل ${INTERVAL_MS / 1000} ثانية`);
  console.log("═".repeat(56));
}

async function main() {
  console.log("\n🚀 ارفع محتويات dist/ (أو فك lunayairmarina-cpanel.zip) إلى public_html");
  console.log("   تأكد من Show Hidden Files عشان .htaccess يترفع\n");

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    printBanner(round);
    const checks = await runChecks();
    let allGreen = true;
    let newBuildLive = false;

    for (const c of checks) {
      const icon = c.ok ? "✅" : "❌";
      console.log(`${icon} ${c.name.padEnd(28)} ${c.detail}`);
      if (!c.ok) allGreen = false;
      if (c.name.includes("Vercel") && c.ok) newBuildLive = true;
    }

    if (newBuildLive && allGreen) {
      console.log("\n🎉 البناء الجديد شغّال على الموقع! جرّب /admin/ai ومسح المحادثات.");
      console.log("   (لو Vercel لسه ما اتعمله redeploy — اعمل Redeploy من Vercel Dashboard)\n");
      process.exit(0);
    }

    if (newBuildLive) {
      console.log("\n⚠️  البناء الجديد ظهر — راجع البنود الحمراء فوق.");
    } else {
      console.log("\n⏳ لسه بانتظر الرفع... (Ctrl+C للإيقاف)");
    }

    if (round < MAX_ROUNDS) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  console.log("\n⏱️  انتهى وقت المراقبة. شغّل تاني: npx tsx scripts/watch-cpanel-upload.ts\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
