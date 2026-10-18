/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
  server: { port: 5173, host: "0.0.0.0", allowedHosts: [".e2b.app"], proxy: {"/api/singularity": {target:"http://127.0.0.1:8792",changeOrigin:false}} },
  preview: { port: 4173, host: "0.0.0.0", allowedHosts: [".e2b.app"], proxy: {"/api/singularity": {target:"http://127.0.0.1:8792",changeOrigin:false}} },
});
