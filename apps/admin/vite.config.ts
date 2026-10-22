import { existsSync } from "node:fs";
import path from "node:path";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Local dev keeps env in the repo-root .env (Vite only reads this app's own
// folder); compose passes DATABASE_URL directly.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

// The team board. Unlike apps/web it renders on the server, because its
// server functions read and write the database.
export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "app"),
    },
  },
  server: { port: 3001, strictPort: true },
  preview: { port: 3001, strictPort: true },
  plugins: [tanstackStart({ srcDirectory: "app" }), viteReact()],
});
