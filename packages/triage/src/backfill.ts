import { type PrismaClient, setEmbedding, submissionsNeedingEmbedding } from "@ac-1/db";
import type { Embedder } from "./embedder.js";

/** A human's routing decision for an existing submission. */
export type Label = { submissionId: string; team: string; reasoning: string };

/**
 * Embeds every submission that has no embedding, or one from a different model.
 * Re-running after a model change re-embeds everything.
 */
export async function backfillEmbeddings(
  db: PrismaClient,
  embedder: Embedder,
): Promise<{ embedded: number; skipped: number }> {
  const total = await db.formSubmission.count();
  const pending = await submissionsNeedingEmbedding(db, embedder.model);
  if (pending.length === 0) return { embedded: 0, skipped: total };

  const vectors = await embedder.embed(pending.map((row) => row.submittedValue));
  await db.$transaction(async (tx) => {
    for (const [i, row] of pending.entries()) {
      await setEmbedding(tx, row.id, vectors[i]!, embedder.model);
    }
  });
  return { embedded: pending.length, skipped: total - pending.length };
}

/**
 * Saves each label as a verified suggestion. Submissions that already have a
 * suggestion are left alone. Checks every label before writing any.
 */
export async function applyLabels(
  db: PrismaClient,
  labels: Label[],
): Promise<{ created: number; skipped: number }> {
  const teams = new Map((await db.team.findMany()).map((t) => [t.name, t.id]));
  const submissions = await db.formSubmission.findMany({
    where: { id: { in: labels.map((l) => l.submissionId) } },
    select: { id: true, suggestedTeam: { select: { id: true } } },
  });
  const byId = new Map(submissions.map((s) => [s.id, s]));

  const problems = labels.flatMap((l) => [
    ...(teams.has(l.team) ? [] : [`unknown team "${l.team}"`]),
    ...(byId.has(l.submissionId) ? [] : [`unknown submission ${l.submissionId}`]),
  ]);
  if (problems.length > 0) throw new Error(`Labels not applied: ${problems.join("; ")}`);

  const toCreate = labels.filter((l) => !byId.get(l.submissionId)!.suggestedTeam);
  await db.$transaction(
    toCreate.map((l) =>
      db.suggestedTeam.create({
        data: {
          formSubmissionId: l.submissionId,
          teamId: teams.get(l.team)!,
          reasoning: l.reasoning,
          hitlVerified: true,
        },
      }),
    ),
  );
  return { created: toCreate.length, skipped: labels.length - toCreate.length };
}
