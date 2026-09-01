import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(dirname(fileURLToPath(import.meta.url)), "lib/index.js"),
  external: [
    "firebase-admin",
    "firebase-admin/*",
    "firebase-functions",
    "firebase-functions/*",
  ],
  alias: {
    "@": resolve(root, "src"),
  },
  logLevel: "info",
});

console.log("[functions] esbuild bundle → lib/index.js");
