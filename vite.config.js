import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // the app reads and writes /api/storage, which in production is served by the same origin.
    // in dev there is no server unless you start one, so forward it
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
