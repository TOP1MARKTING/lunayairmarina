/**
 * Write dist/.htaccess for Apache/cPanel from VITE_SITE_URL (canonical site origin).
 * Called at the end of the static build — does not commit generated rules to git.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

function escapeRegexHost(host: string): string {
  return host.replace(/\./g, "\\.");
}

function generateHtaccess(siteUrl: string, apiOrigin: string): string {
  const canonical = siteUrl.replace(/\/$/, "");
  const vercelApi = apiOrigin.replace(/\/$/, "");
  let hostname: string;
  try {
    hostname = new URL(canonical).hostname;
  } catch {
    throw new Error(`[generate-htaccess] invalid site URL: ${siteUrl}`);
  }

  const isWww = hostname.startsWith("www.");
  const apexHost = isWww ? hostname.slice(4) : hostname;

  let apexToWwwRule = "";
  if (isWww && apexHost.includes(".")) {
    apexToWwwRule = `
  # --- Apex → www (canonical host matches VITE_SITE_URL) ---
  RewriteCond %{HTTP_HOST} ^${escapeRegexHost(apexHost)}$ [NC]
  RewriteRule ^ ${canonical}%{REQUEST_URI} [R=301,L]`;
  }

  return `# LunayAir Marina — Apache/cPanel static hosting (SPA + prerendered public pages)
# Generated for canonical origin: ${canonical}
<IfModule mod_rewrite.c>
  RewriteEngine On

  # --- HTTPS (skip on localhost for local smoke tests) ---
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP_HOST} !^localhost(:\\d+)?$ [NC]
  RewriteCond %{HTTP_HOST} !^127\\.0\\.0\\.1(:\\d+)?$ [NC]
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
${apexToWwwRule}

  # --- Proxy TanStack server functions to Vercel (browser keeps ${canonical}/_serverFn/...) ---
  RewriteCond %{REQUEST_URI} ^/_serverFn/ [NC]
  RewriteRule ^ ${vercelApi}%{REQUEST_URI} [P,L]

  # --- SPA fallback: serve real files/directories first ---
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>

# Admin surfaces should not be indexed.
<IfModule mod_headers.c>
  SetEnvIf Request_URI "^/admin" admin_area=1
  Header set X-Robots-Tag "noindex, nofollow, noarchive" env=admin_area
</IfModule>

# Long-cache immutable build assets (Vite hashed filenames).
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType video/mp4 "access plus 1 year"
</IfModule>
`;
}

function main() {
  const siteUrl =
    process.env.VITE_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "https://www.lunayairmarina.com";
  const apiOrigin =
    process.env.VITE_VERCEL_API_ORIGIN?.trim() ||
    process.env.VITE_API_BASE_URL?.trim() ||
    "https://lunayairmarina.vercel.app";

  if (!existsSync(dist)) {
    mkdirSync(dist, { recursive: true });
  }

  const outPath = resolve(dist, ".htaccess");
  writeFileSync(outPath, generateHtaccess(siteUrl, apiOrigin), "utf8");
  console.log(`[generate-htaccess] wrote ${outPath} for ${siteUrl.replace(/\/$/, "")} → ${apiOrigin}`);
}

main();
