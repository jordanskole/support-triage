import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Local dev keeps env in the repo-root .env; compose and CI pass env directly.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node dist/seed.js",
  },
  datasource: {
    // Not env("DATABASE_URL"): that throws when unset, and `prisma generate`
    // (run by build, including inside docker build) needs no database.
    url: process.env.DATABASE_URL ?? "",
  },
});
