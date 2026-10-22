import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");
// Tests must never reach a paid API. Without keys, an accidental real client fails loudly.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VOYAGE_API_KEY;

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
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/cli/**", "src/test/**"],
    },
  },
});
