import type { PrismaClient } from "./generated/prisma/client.js";
import { MAX_NOTE_LENGTH } from "./limits.js";

/** Where the card's latest move came from. */
export type CardOrigin =
  | { kind: "auto" }
  | { kind: "transfer"; fromTeam: string | null }
  | { kind: "unrouted" };

export type BoardCard = {
  id: string;
  text: string;
  createdAt: Date;
  holderTeamId: string | null;
  origin: CardOrigin;
};

export type Board = {
  /** Every team, by name, with its open submissions oldest first. */
  teams: { id: string; name: string; cards: BoardCard[] }[];
  /** Open submissions no team holds, because triage failed after saving. */
  unrouted: BoardCard[];
};

export type TrailEntry =
  | { kind: "auto"; team: string; reasoning: string; at: Date }
  | { kind: "transfer"; from: string | null; to: string; reason: string; at: Date }
  | { kind: "answer"; team: string; body: string; backfilled: boolean; at: Date };

export type SubmissionDetail = {
  id: string;
  text: string;
  email: string;
  createdAt: Date;
  status: "open" | "answered" | "unrouted";
  holder: { id: string; name: string } | null;
  /** Oldest first. */
  trail: TrailEntry[];
};

export type AnsweredItem = {
  id: string;
  text: string;
  team: string;
  answeredAt: Date;
  backfilled: boolean;
};

/** Someone else moved or answered the submission first. Refresh and retry. */
export class BoardConflictError extends Error {
  override name = "BoardConflictError";
  constructor() {
    super("This request moved.");
  }
}

/** The request can't be applied as written; nothing was saved. */
export class BoardValidationError extends Error {
  override name = "BoardValidationError";
}

const latestTransfer = {
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { fromTeam: { select: { name: true } } },
} as const;

const cardSelect = {
  id: true,
  submittedValue: true,
  createdAt: true,
  holderTeamId: true,
  suggestedTeam: { select: { id: true } },
  transfers: latestTransfer,
} as const;

type CardRow = {
  id: string;
  submittedValue: string;
  createdAt: Date;
  holderTeamId: string | null;
  suggestedTeam: { id: string } | null;
  transfers: { fromTeam: { name: string } | null }[];
};

function toCard(row: CardRow): BoardCard {
  const [last] = row.transfers;
  const origin: CardOrigin = last
    ? { kind: "transfer", fromTeam: last.fromTeam?.name ?? null }
    : row.suggestedTeam
      ? { kind: "auto" }
      : { kind: "unrouted" };
  return {
    id: row.id,
    text: row.submittedValue,
    createdAt: row.createdAt,
    holderTeamId: row.holderTeamId,
    origin,
  };
}

export async function getBoard(db: PrismaClient): Promise<Board> {
  const open = { answeredAt: null };
  const oldestFirst = { createdAt: "asc" } as const;
  const [teams, unrouted] = await Promise.all([
    db.team.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        heldSubmissions: { where: open, orderBy: oldestFirst, select: cardSelect },
      },
    }),
    db.formSubmission.findMany({
      where: { ...open, holderTeamId: null },
      orderBy: oldestFirst,
      select: cardSelect,
    }),
  ]);
  return {
    teams: teams.map((t) => ({ id: t.id, name: t.name, cards: t.heldSubmissions.map(toCard) })),
    unrouted: unrouted.map(toCard),
  };
}

export async function getAnswered(db: PrismaClient): Promise<AnsweredItem[]> {
  const rows = await db.formSubmission.findMany({
    where: { answeredAt: { not: null } },
    orderBy: { answeredAt: "desc" },
    select: {
      id: true,
      submittedValue: true,
      answeredAt: true,
      answerBackfilled: true,
      holderTeam: { select: { name: true } },
    },
  });
  // The CHECK constraints guarantee an answered submission has a time and a holder.
  return rows.map((r) => ({
    id: r.id,
    text: r.submittedValue,
    team: r.holderTeam!.name,
    answeredAt: r.answeredAt!,
    backfilled: r.answerBackfilled,
  }));
}

export async function getSubmissionDetail(
  db: PrismaClient,
  id: string,
): Promise<SubmissionDetail | null> {
  const row = await db.formSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      submittedValue: true,
      createdAt: true,
      answer: true,
      answeredAt: true,
      answerBackfilled: true,
      user: { select: { email: true } },
      holderTeam: { select: { id: true, name: true } },
      suggestedTeam: { select: { reasoning: true, createdAt: true, team: { select: { name: true } } } },
      transfers: {
        orderBy: { createdAt: "asc" },
        select: {
          reason: true,
          createdAt: true,
          fromTeam: { select: { name: true } },
          toTeam: { select: { name: true } },
        },
      },
    },
  });
  if (!row) return null;

  const trail: TrailEntry[] = [];
  // A backfilled answer's pick came from a reviewer's label, not the agent.
  if (row.suggestedTeam && !row.answerBackfilled) {
    trail.push({
      kind: "auto",
      team: row.suggestedTeam.team.name,
      reasoning: row.suggestedTeam.reasoning,
      at: row.suggestedTeam.createdAt,
    });
  }
  for (const t of row.transfers) {
    trail.push({
      kind: "transfer",
      from: t.fromTeam?.name ?? null,
      to: t.toTeam.name,
      reason: t.reason,
      at: t.createdAt,
    });
  }
  if (row.answer !== null && row.answeredAt && row.holderTeam) {
    trail.push({
      kind: "answer",
      team: row.holderTeam.name,
      body: row.answer,
      backfilled: row.answerBackfilled,
      at: row.answeredAt,
    });
  }

  return {
    id: row.id,
    text: row.submittedValue,
    email: row.user.email,
    createdAt: row.createdAt,
    status: row.answeredAt ? "answered" : row.holderTeam ? "open" : "unrouted",
    holder: row.holderTeam,
    trail,
  };
}

/**
 * Moves a submission to `toTeamId`, if `expectedHolderTeamId` still holds it
 * and it is unanswered. The holder check and the move are one UPDATE, so two
 * people moving the same card can't both succeed.
 */
export async function transferSubmission(
  db: PrismaClient,
  input: { submissionId: string; expectedHolderTeamId: string | null; toTeamId: string; reason: string },
): Promise<void> {
  const reason = note(input.reason, "reason");
  if (input.toTeamId === input.expectedHolderTeamId) {
    throw new BoardValidationError("It's already with that team.");
  }
  if (!(await db.team.findUnique({ where: { id: input.toTeamId }, select: { id: true } }))) {
    throw new BoardValidationError("Unknown team.");
  }

  await db.$transaction(async (tx) => {
    const { count } = await tx.formSubmission.updateMany({
      where: { id: input.submissionId, holderTeamId: input.expectedHolderTeamId, answeredAt: null },
      data: { holderTeamId: input.toTeamId },
    });
    if (count === 0) throw await missOrConflict(tx, input.submissionId);
    await tx.transfer.create({
      data: {
        formSubmissionId: input.submissionId,
        fromTeamId: input.expectedHolderTeamId,
        toTeamId: input.toTeamId,
        reason,
      },
    });
  });
}

/**
 * Saves the holder's answer, which closes the submission. Like a transfer, it
 * applies only if `expectedHolderTeamId` still holds it unanswered.
 */
export async function answerSubmission(
  db: PrismaClient,
  input: { submissionId: string; expectedHolderTeamId: string; body: string },
): Promise<void> {
  const answer = note(input.body, "answer");
  const { count } = await db.formSubmission.updateMany({
    where: { id: input.submissionId, holderTeamId: input.expectedHolderTeamId, answeredAt: null },
    data: { answer, answeredAt: new Date() },
  });
  if (count === 0) throw await missOrConflict(db, input.submissionId);
}

/** Trims `text` and checks it against the note cap, in code points as Postgres counts. */
function note(text: string, what: string): string {
  const trimmed = text.trim();
  if (trimmed === "") throw new BoardValidationError(`The ${what} is empty.`);
  const length = [...trimmed].length;
  if (length > MAX_NOTE_LENGTH) {
    throw new BoardValidationError(
      `The ${what} is ${length} characters; the limit is ${MAX_NOTE_LENGTH}.`,
    );
  }
  return trimmed;
}

async function missOrConflict(
  db: Pick<PrismaClient, "formSubmission">,
  submissionId: string,
): Promise<Error> {
  const exists = await db.formSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true },
  });
  return exists ? new BoardConflictError() : new BoardValidationError("Unknown request.");
}
