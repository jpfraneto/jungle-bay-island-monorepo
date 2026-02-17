import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["miniapp.anky.app"],
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
