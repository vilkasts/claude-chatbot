import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the web client.
// Vite is consumed in two ways:
//   1) `npm run build:web` — produces a static bundle into apps/web/dist for
//      the production Node server to serve.
//   2) Loaded as middleware by apps/server/index.ts in dev mode — same config,
//      but Vite is not its own HTTP server in that case.
//
// `@bot` alias lets components import shared constants (like the welcome
// message) from bot/shared/ — the same source the CLI and server use.
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@bot": path.resolve(__dirname, "..", "..", "bot"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
