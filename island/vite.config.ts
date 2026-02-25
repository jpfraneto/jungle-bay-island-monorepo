import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  // Keep root URL in dev, but emit /island/* asset paths for production build.
  base: command === "build" || isPreview ? "/island/" : "/",
  build: {
    outDir: "../backend/public/island",
    emptyOutDir: true,
    manifest: true,
  },
  server: {
    allowedHosts: ["miniapp.anky.app"],
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
}));
