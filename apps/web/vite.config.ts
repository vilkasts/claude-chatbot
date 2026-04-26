import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the web client.
// `root` points at this directory so html/main.tsx are found here, while
// the build output drops into apps/web/dist where the production server
// looks for it. The /api proxy lets dev (port 5173) talk to the API
// server (port 3000) without CORS preflight on every request.
//
// `@bot` alias lets components import shared constants (like the welcome
// message) from bot/shared/ - the same source the CLI and server use.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@bot": path.resolve(__dirname, "..", "..", "bot"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
