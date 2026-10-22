import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  findNeighbours,
  setEmbedding,
  submissionsNeedingEmbedding,
} from "./embeddings.js";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();
const MODEL = "test-model";

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

/** A vector pointing along axis `i`. */
function unit(i: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i] = 1;
  return v;
}

/** A vector between axes `i` and `j`; `w` is the weight on `j`. */
function mix(i: number, j: number, w: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i] = 1 - w;
  v[j] = w;
  return v;
}

async function fixtures() {
  const support = await db.team.create({ data: { name: "Support", description: "help" } });
  const sales = await db.team.create({ data: { name: "Sales", description: "buy" } });
  const user = await db.user.create({ data: { email: "ada@example.com" } });
  return { support, sales, user };
}

async function submission(
  text: string,
  opts: {
    userId: string;
    teamId?: string;
    answered?: boolean;
    backfilled?: boolean;
    answer?: string;
    transfers?: { fromTeamId: string | null; toTeamId: string; reason: string }[];
    vector?: number[];
    model?: string;
  },
) {
  const row = await db.formSubmission.create({
    data: { submittedValue: text, userId: opts.userId },
  });
  if (opts.vector) await setEmbedding(db, row.id, opts.vector, opts.model ?? MODEL);
  if (opts.teamId) {
    await db.suggestedTeam.create({
      data: { formSubmissionId: row.id, teamId: opts.teamId, reasoning: `auto ${text}` },
    });
    const transfers = opts.transfers ?? [];
    for (const [i, t] of transfers.entries()) {
      await db.transfer.create({
        data: { formSubmissionId: row.id, ...t, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) },
      });
    }
    const answered = opts.answered ?? true;
    await db.formSubmission.update({
      where: { id: row.id },
      data: {
        holderTeamId: transfers.at(-1)?.toTeamId ?? opts.teamId,
        ...(answered && {
          answer: opts.answer ?? `answer ${text}`,
          answeredAt: new Date(),
          answerBackfilled: opts.backfilled ?? false,
        }),
      },
    });
  }
  return row;
}

describe("findNeighbours", () => {
  it("returns answered neighbours nearest first", async () => {
    const { support, user } = await fixtures();
    const first = await submission("first", { userId: user.id, teamId: support.id, vector: unit(0) });
    const second = await submission("second", {
      userId: user.id,
      teamId: support.id,
      vector: mix(0, 1, 0.5),
    });
    await submission("third", { userId: user.id, teamId: support.id, vector: unit(1) });

    const result = await findNeighbours(db, { vector: unit(0), model: MODEL, k: 2 });

    expect(result.map((n) => n.submissionId)).toEqual([first.id, second.id]);
    expect(result[0]).toMatchObject({
      text: "first",
      team: "Support",
      answer: "answer first",
      backfilled: false,
      transfers: [],
    });
    expect(result[0]!.similarity).toBeCloseTo(1);
  });

  it("uses the answering team and answer, with transfers oldest first", async () => {
    const { support, sales, user } = await fixtures();
    await submission("upgrade", {
      userId: user.id,
      teamId: support.id,
      vector: unit(0),
      answer: "Upgraded your plan.",
      transfers: [
        { fromTeamId: support.id, toTeamId: sales.id, reason: "it's an upgrade" },
        { fromTeamId: sales.id, toTeamId: support.id, reason: "actually a how-to" },
        { fromTeamId: support.id, toTeamId: sales.id, reason: "no, pricing" },
      ],
    });

    const [n] = await findNeighbours(db, { vector: unit(0), model: MODEL, k: 5 });

    expect(n).toMatchObject({ team: "Sales", answer: "Upgraded your plan." });
    expect(n!.transfers).toEqual([
      { from: "Support", to: "Sales", reason: "it's an upgrade" },
      { from: "Sales", to: "Support", reason: "actually a how-to" },
      { from: "Support", to: "Sales", reason: "no, pricing" },
    ]);
  });

  it("marks backfilled answers", async () => {
    const { support, user } = await fixtures();
    await submission("labelled", {
      userId: user.id,
      teamId: support.id,
      vector: unit(0),
      backfilled: true,
    });

    const [n] = await findNeighbours(db, { vector: unit(0), model: MODEL, k: 5 });

    expect(n).toMatchObject({ backfilled: true });
  });

  it("skips open, unembedded, other-model and excluded rows", async () => {
    const { support, sales, user } = await fixtures();
    await submission("open", { userId: user.id, teamId: support.id, vector: unit(0), answered: false });
    await submission("open after a transfer", {
      userId: user.id,
      teamId: support.id,
      vector: unit(0),
      answered: false,
      transfers: [{ fromTeamId: support.id, toTeamId: sales.id, reason: "sales" }],
    });
    await submission("unrouted", { userId: user.id, vector: unit(0) });
    await submission("unembedded", { userId: user.id, teamId: support.id });
    await submission("other model", {
      userId: user.id,
      teamId: support.id,
      vector: unit(0),
      model: "other",
    });
    const self = await submission("self", { userId: user.id, teamId: support.id, vector: unit(0) });

    const result = await findNeighbours(db, {
      vector: unit(0),
      model: MODEL,
      k: 5,
      excludeSubmissionId: self.id,
    });

    expect(result).toEqual([]);
  });
});

describe("setEmbedding", () => {
  it("rejects a vector of the wrong length", async () => {
    const { user } = await fixtures();
    const row = await submission("x", { userId: user.id });
    await expect(setEmbedding(db, row.id, unit(0).slice(1), MODEL)).rejects.toThrow(/1024/);
  });
});

describe("submissionsNeedingEmbedding", () => {
  it("returns null and other-model rows only", async () => {
    const { user } = await fixtures();
    const missing = await submission("missing", { userId: user.id });
    const stale = await submission("stale", { userId: user.id, vector: unit(0), model: "old" });
    await submission("current", { userId: user.id, vector: unit(0) });

    const rows = await submissionsNeedingEmbedding(db, MODEL);

    expect(rows.map((r) => r.id).sort()).toEqual([missing.id, stale.id].sort());
    expect(rows.find((r) => r.id === missing.id)?.submittedValue).toBe("missing");
  });
});
