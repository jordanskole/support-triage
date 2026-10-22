import {
  findNeighbours,
  getRoutingGuidance,
  MAX_SUBMISSION_LENGTH,
  type Neighbour,
  type PrismaClient,
  setEmbedding,
} from "@support-triage/db";
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

  // Route before saving, so the board never sees the submission without a
  // team while the classifier is thinking (it would show up as unrouted, and a
  // drag from there could be overwritten by the pick).
  let routed: { teamId: string; team: string; reasoning: string; neighbours: Neighbour[] } | undefined;
  let routingError: unknown;
  try {
    const neighbours = await findNeighbours(db, {
      vector,
      model: deps.embedder.model,
      k: NEIGHBOUR_COUNT,
    });
    const teams = await db.team.findMany({
      select: { id: true, name: true, description: true },
      orderBy: { name: "asc" },
    });
    const guidance = await getRoutingGuidance(db);
    const { team, reasoning } = await deps.classifier.classify({
      request: text,
      guidance,
      teams,
      neighbours,
    });
    const teamId = teams.find((t) => t.name === team)?.id;
    if (!teamId) throw new Error(`Unknown team "${team}"`);
    routed = { teamId, team, reasoning, neighbours };
  } catch (error) {
    routingError = error;
  }

  const save = () =>
    db.$transaction(async (tx) => {
      const user = await tx.user.upsert({ where: { email }, create: { email }, update: {} });
      const row = await tx.formSubmission.create({
        // The pick is an assignment: the team holds the submission from the start.
        data: { submittedValue: text, userId: user.id, holderTeamId: routed?.teamId ?? null },
      });
      await setEmbedding(tx, row.id, vector, deps.embedder.model);
      if (routed) {
        await tx.suggestedTeam.create({
          data: { formSubmissionId: row.id, teamId: routed.teamId, reasoning: routed.reasoning },
        });
      }
      return row;
    });
  // Prisma's upsert is SELECT-then-INSERT, so two first requests from one email
  // can both try to create the user. The loser rolls back; by the retry the
  // winner's user is committed and the upsert finds it.
  const submission = await save().catch((error: unknown) => {
    if (isUniqueViolation(error)) return save();
    throw error;
  });

  // Routing failed: the request is still saved, unrouted, for a team to pick up.
  if (!routed) throw new TriageFailedError(submission.id, routingError);
  const { team, reasoning, neighbours } = routed;
  return { submissionId: submission.id, team, reasoning, neighbours };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}
