import path from "node:path";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "app"),
    },
  },
  plugins: [
    // Client-side only: SPA mode emits a static shell, no SSR at runtime.
    tanstackStart({
      srcDirectory: "app",
      spa: {
        enabled: true,
      },
      prerender: {
        enabled: false,
      },
    }),
    viteReact(),
  ],
});
