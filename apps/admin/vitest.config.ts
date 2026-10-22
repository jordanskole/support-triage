import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["app/lib/**/*.ts", "app/server/result.ts"],
      exclude: ["app/**/*.test.ts"],
    },
  },
});
