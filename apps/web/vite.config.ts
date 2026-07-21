import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700
  },
  server: {
    port: 5173,
    proxy: {
      "/streams": {
        target: "http://localhost:7373"
      },
      "/api": {
        target: "http://localhost:7373",
        ws: true
      }
    }
  }
});
