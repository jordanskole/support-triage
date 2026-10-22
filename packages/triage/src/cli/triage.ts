import { parseArgs } from "node:util";
import { createDb } from "@ac-1/db";
import { loadRootEnv, requireEnv } from "../env.js";
import { SubmissionRejectedError, triage, TriageFailedError } from "../triage.js";
import { realClients } from "./clients.js";

const USAGE = 'Usage: npm run triage -- "<request text>" --email <email>';

const { values, positionals } = parseArgs({
  options: { email: { type: "string" } },
  allowPositionals: true,
});
const text = positionals.join(" ");
if (!text || !values.email) {
  console.error(USAGE);
  process.exit(1);
}

loadRootEnv();
const env = requireEnv(["DATABASE_URL", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]);
const db = createDb(env.DATABASE_URL);

try {
  const result = await triage(db, realClients(env), { text, email: values.email });
  console.log(`team:       ${result.team}`);
  console.log(`reasoning:  ${result.reasoning}`);
  console.log(`submission: ${result.submissionId}`);
  console.log(result.neighbours.length === 0 ? "neighbours: none" : "neighbours:");
  for (const n of result.neighbours) {
    console.log(`  ${n.similarity.toFixed(2)}  ${n.team.padEnd(15)} ${n.text.slice(0, 70).replace(/\s+/g, " ")}`);
  }
} catch (error) {
  if (error instanceof SubmissionRejectedError) console.error(`Rejected: ${error.message}`);
  else if (error instanceof TriageFailedError) console.error(error.message);
  else console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
