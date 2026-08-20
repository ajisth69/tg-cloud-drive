import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    port: 5173,
    host: "localhost",
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": "/src",
      "@mtcute/node/utils.js": "/src/lib/emptyModule.ts",
      "@mtcute/node": "/src/lib/emptyModule.ts",
    },
  },
  optimizeDeps: {
    exclude: ["@mtcute/convert"],
  },
  build: {
    target: "esnext",
  },
});
