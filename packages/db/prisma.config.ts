import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Local dev keeps env in the repo-root .env; compose and CI pass env directly.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node dist/seed.js",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
