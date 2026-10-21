import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/generated/**", "src/test/**"],
    },
  },
});
