import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single-file output keeps the current deploy model (one index.html on S3,
// opens from file://). The dataset is NOT bundled: build-standalone.mjs injects
// it as window.__PRICING__ afterwards; `vite dev` fetches ../web/pricing.json.
export default defineConfig(({ command }) => ({
  plugins: [react(), viteSingleFile()],
  publicDir: command === "serve" ? "../web" : false,
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4096 },
  server: { host: "127.0.0.1" },
}));
