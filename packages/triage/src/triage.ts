import {
  findNeighbours,
  MAX_SUBMISSION_LENGTH,
  type Neighbour,
  type PrismaClient,
  setEmbedding,
} from "@ac-1/db";
import type { Classifier } from "./classifier.js";
import type { Embedder } from "./embedder.js";

/** How many past decisions Claude sees next to a new request. */
export const NEIGHBOUR_COUNT = 5;

/** The request can't be accepted as written; nothing was saved. */
export class SubmissionRejectedError extends Error {
  override name = "SubmissionRejectedError";
}

/** The submission was saved, but no team was suggested for it. */
export class TriageFailedError extends Error {
  override name = "TriageFailedError";
  constructor(
    readonly submissionId: string,
    cause: unknown,
  ) {
    super(
      `Submission ${submissionId} was saved but could not be triaged: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}

export type TriageResult = {
  submissionId: string;
  team: string;
  reasoning: string;
  neighbours: Neighbour[];
};

export async function triage(
  db: PrismaClient,
  deps: { embedder: Embedder; classifier: Classifier },
  input: { text: string; email: string },
): Promise<TriageResult> {
  const { text, email } = input;
  if (text.trim() === "") throw new SubmissionRejectedError("The request is empty.");
  // Count code points, as Postgres VARCHAR does; `.length` counts an emoji as 2.
  const length = [...text].length;
  if (length > MAX_SUBMISSION_LENGTH) {
    throw new SubmissionRejectedError(
      `The request is ${length} characters; the limit is ${MAX_SUBMISSION_LENGTH}.`,
    );
  }

  // Embed before writing anything, so a Voyage failure leaves no trace.
  const [vector] = await deps.embedder.embed([text]);
  if (!vector) throw new Error("The embedder returned no vector.");

  const submission = await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({ where: { email }, create: { email }, update: {} });
    const row = await tx.formSubmission.create({
      data: { submittedValue: text, userId: user.id },
    });
    await setEmbedding(tx, row.id, vector, deps.embedder.model);
    return row;
  });

  try {
    const neighbours = await findNeighbours(db, {
      vector,
      model: deps.embedder.model,
      k: NEIGHBOUR_COUNT,
      excludeSubmissionId: submission.id,
    });
    const teams = await db.team.findMany({
      select: { id: true, name: true, description: true },
      orderBy: { name: "asc" },
    });
    const { team, reasoning } = await deps.classifier.classify({ request: text, teams, neighbours });

    const teamId = teams.find((t) => t.name === team)?.id;
    if (!teamId) throw new Error(`Unknown team "${team}"`);
    await db.suggestedTeam.create({
      data: { formSubmissionId: submission.id, teamId, reasoning },
    });

    return { submissionId: submission.id, team, reasoning, neighbours };
  } catch (error) {
    throw new TriageFailedError(submission.id, error);
  }
}
