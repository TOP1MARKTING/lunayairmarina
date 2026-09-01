/**
 * Create a clean ZIP of dist/ for cPanel upload (no secrets, no node_modules).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const outZip = resolve(root, "lunayairmarina-cpanel.zip");

if (!existsSync(dist)) {
  console.error("[package-cpanel] dist/ missing — run npm run build:static first");
  process.exit(1);
}

// Prefer system zip when available (faster, standard on Windows 10+ / Linux).
try {
  if (existsSync(outZip)) {
    execSync(`powershell -NoProfile -Command "Remove-Item -Force '${outZip.replace(/'/g, "''")}'"`, {
      stdio: "ignore",
    });
  }
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${dist.replace(/'/g, "''")}\\*' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" },
  );
  console.log(`[package-cpanel] created ${outZip}`);
} catch (error) {
  console.error("[package-cpanel] failed to create zip:", error instanceof Error ? error.message : error);
  process.exit(1);
}
