// One-time copy of Hygraph content into Postgres. Safe to re-run.
// Usage: npm run import:hygraph -w @ac-1/db (needs HYGRAPH_ENDPOINT, HYGRAPH_TOKEN, DATABASE_URL)
import { existsSync } from "node:fs";
import { createDb } from "./client.js";
import { applyImport } from "./hygraph/apply.js";
import { fetchHygraphSnapshot, readHygraphConfig } from "./hygraph/fetch.js";
import { mapSnapshot } from "./hygraph/map.js";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

try {
  const snapshot = await fetchHygraphSnapshot(readHygraphConfig(process.env));
  const db = createDb();
  try {
    const counts = await applyImport(db, mapSnapshot(snapshot));
    for (const [model, count] of Object.entries(counts)) console.log(`${model} ${count}`);
  } finally {
    await db.$disconnect();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
