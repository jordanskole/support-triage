import { createDb } from "@ac-1/db";
import { EMBEDDING_MODEL } from "../embedder.js";
import { loadRootEnv, requireEnv } from "../env.js";
import { evaluate } from "../eval.js";
import { realClients } from "./clients.js";

loadRootEnv();
const env = requireEnv(["DATABASE_URL", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]);
const db = createDb(env.DATABASE_URL);

try {
  const report = await evaluate(db, realClients(env).classifier, { model: EMBEDDING_MODEL });
  console.log(`score: ${report.correct}/${report.total}`);
  for (const m of report.misses) {
    console.log(`miss ${m.submissionId}: expected ${m.expected}, got ${m.got}\n  ${m.reasoning}`);
  }
  for (const f of report.failures) console.log(`failed ${f.submissionId}: ${f.error}`);
  console.log(`tokens: ${report.usage.inputTokens} in, ${report.usage.outputTokens} out`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
