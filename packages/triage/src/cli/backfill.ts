import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDb } from "@support-triage/db";
import { z } from "zod";
import { applyLabels, backfillEmbeddings } from "../backfill.js";
import { voyageEmbedder } from "../embedder.js";
import { loadRootEnv, requireEnv } from "../env.js";

const Labels = z.array(
  z.object({ submissionId: z.string(), team: z.string(), reasoning: z.string().min(1) }),
);

const { values } = parseArgs({ options: { labels: { type: "string" } } });

loadRootEnv();
const env = requireEnv(["DATABASE_URL", "VOYAGE_API_KEY"]);
const db = createDb(env.DATABASE_URL);

try {
  const embeddings = await backfillEmbeddings(db, voyageEmbedder({ apiKey: env.VOYAGE_API_KEY }));
  console.log(`embeddings: embedded ${embeddings.embedded}, skipped ${embeddings.skipped}`);

  if (values.labels) {
    const labels = Labels.parse(JSON.parse(readFileSync(values.labels, "utf8")));
    const result = await applyLabels(db, labels);
    console.log(`labels: created ${result.created}, skipped ${result.skipped}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
