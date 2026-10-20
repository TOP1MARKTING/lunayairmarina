import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import tsConfigPaths from "vite-tsconfig-paths";
import { listStaticPrerenderPaths } from "./scripts/staticPrerenderRoutes";

/**
 * Static hosting build for Apache/cPanel (no Nitro / no Node runtime on cPanel).
 * SSR is used only at build time for prerendering public routes.
 *
 * Default runtime API: Firebase Cloud Functions (VITE_API_TRANSPORT=http).
 * Optional: Vercel TanStack server-fn (VITE_API_TRANSPORT=server-fn).
 */
export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const transport = loadedEnv.VITE_API_TRANSPORT?.trim() || "server-fn";
  const siteUrl = (loadedEnv.VITE_SITE_URL?.trim() || "https://www.lunayairmarina.com").replace(
    /\/$/,
    "",
  );
  const functionsBase = (
    loadedEnv.VITE_FUNCTIONS_BASE_URL?.trim() ||
    "https://us-central1-lunayairmarina-2d694.cloudfunctions.net"
  ).replace(/\/$/, "");
  const apiBase = (
    loadedEnv.VITE_API_BASE_URL?.trim() ||
    (transport === "http" ? siteUrl : "https://lunayairmarina.vercel.app")
  ).replace(/\/$/, "");

  const envDefine: Record<string, string> = {
    "import.meta.env.VITE_API_TRANSPORT": JSON.stringify(transport),
    "import.meta.env.VITE_STATIC_HOSTING": JSON.stringify("true"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBase),
    "import.meta.env.VITE_SITE_URL": JSON.stringify(siteUrl),
  };

  if (transport === "http") {
    envDefine["import.meta.env.VITE_FUNCTIONS_BASE_URL"] = JSON.stringify(functionsBase);
  } else {
    envDefine["import.meta.env.VITE_TSS_SERVER_FN_BASE"] = JSON.stringify(`${apiBase}/_serverFn/`);
  }

  for (const [key, value] of Object.entries(loadedEnv)) {
    if (transport === "http" && key === "VITE_TSS_SERVER_FN_BASE") continue;
    if (transport !== "http" && key === "VITE_FUNCTIONS_BASE_URL") continue;
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const aliases: Array<{ find: string; replacement: string }> = [
    { find: "@", replacement: resolve(process.cwd(), "src") },
  ];
  // Only stub CF HTTP helper when the static build is locked to Vercel server-fn.
  if (transport !== "http") {
    aliases.unshift({
      find: "@/lib/api/config.firebaseHttp",
      replacement: resolve(process.cwd(), "src/lib/api/config.firebaseHttp.stub.ts"),
    });
  }

  const prerenderPaths = listStaticPrerenderPaths();

  return {
    define: envDefine,
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    resolve: {
      alias: aliases,
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
        prerender: {
          enabled: true,
          crawlLinks: true,
          autoStaticPathsDiscovery: false,
          failOnError: true,
          filter: ({ path }) =>
            !path.startsWith("/admin") && !/\.(mp4|webm|mov|m4v|pdf|zip)$/i.test(path),
        },
        pages: prerenderPaths.map((path) => ({
          path,
          prerender: { enabled: true },
        })),
        spa: {
          enabled: true,
          maskPath: "/",
          prerender: {
            enabled: true,
            outputPath: "/index.html",
            crawlLinks: false,
          },
        },
      }),
      viteReact(),
    ],
  };
});
