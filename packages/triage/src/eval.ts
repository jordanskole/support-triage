import { findNeighbours, getEmbedding, getRoutingGuidance, type PrismaClient } from "@support-triage/db";
import type { Classifier } from "./classifier.js";
import { NEIGHBOUR_COUNT } from "./triage.js";

export type EvalReport = {
  total: number;
  correct: number;
  misses: { submissionId: string; expected: string; got: string; reasoning: string }[];
  failures: { submissionId: string; error: string }[];
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * Leave-one-out over every answered submission embedded with `model`: hide it
 * from retrieval, ask the classifier, and compare with the team that answered.
 * Reuses stored embeddings and writes nothing.
 */
export async function evaluate(
  db: PrismaClient,
  classifier: Classifier,
  opts: { model: string },
): Promise<EvalReport> {
  const answered = await db.formSubmission.findMany({
    where: { answeredAt: { not: null }, embeddingModel: opts.model },
    select: { id: true, submittedValue: true, holderTeam: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const teams = await db.team.findMany({
    select: { name: true, description: true },
    orderBy: { name: "asc" },
  });
  const guidance = await getRoutingGuidance(db);

  const report: EvalReport = {
    total: answered.length,
    correct: 0,
    misses: [],
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  for (const { id, submittedValue, holderTeam } of answered) {
    // The CHECK constraint guarantees an answered submission has a holder.
    const expected = holderTeam!.name;
    try {
      const embedding = await getEmbedding(db, id);
      if (!embedding) throw new Error("no embedding");
      const neighbours = await findNeighbours(db, {
        vector: embedding.vector,
        model: opts.model,
        k: NEIGHBOUR_COUNT,
        excludeSubmissionId: id,
      });
      const result = await classifier.classify({
        request: submittedValue,
        guidance,
        teams,
        neighbours,
      });
      report.usage.inputTokens += result.usage.inputTokens;
      report.usage.outputTokens += result.usage.outputTokens;
      if (result.team === expected) report.correct += 1;
      else report.misses.push({ submissionId: id, expected, got: result.team, reasoning: result.reasoning });
    } catch (error) {
      report.failures.push({
        submissionId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
