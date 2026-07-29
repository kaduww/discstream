import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/restorations": {
        target: "http://localhost:7373"
      },
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
