import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { listStaticPrerenderPaths } from "./scripts/staticPrerenderRoutes";

/**
 * Static hosting build for Apache/cPanel (no Nitro / no Node runtime on server).
 * SSR is used only at build time for prerendering public routes.
 */
export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const apiBase = (loadedEnv.VITE_API_BASE_URL?.trim() || "https://www.lunayairmarina.com").replace(
    /\/$/,
    "",
  );
  const envDefine: Record<string, string> = {
    "import.meta.env.VITE_API_TRANSPORT": JSON.stringify(
      loadedEnv.VITE_API_TRANSPORT?.trim() || "http",
    ),
    "import.meta.env.VITE_STATIC_HOSTING": JSON.stringify("true"),
    "process.env.TSS_SERVER_FN_BASE": JSON.stringify(`${apiBase}/_serverFn/`),
  };
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const prerenderPaths = listStaticPrerenderPaths();

  return {
    define: envDefine,
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
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
