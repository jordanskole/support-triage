import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  answerSubmission,
  BoardConflictError,
  BoardValidationError,
  getAnswered,
  getBoard,
  getSubmissionDetail,
  transferSubmission,
} from "./board.js";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

async function teams() {
  const finance = await db.team.create({ data: { name: "Finance", description: "money" } });
  const support = await db.team.create({ data: { name: "Support", description: "help" } });
  const sales = await db.team.create({ data: { name: "Sales", description: "buy" } });
  const user = await db.user.create({ data: { email: "ada@example.com" } });
  return { finance, support, sales, user };
}

let clock = 0;
/** A submission picked for `teamId` (or unrouted), created in a known order. */
async function submission(userId: string, text: string, teamId?: string) {
  const row = await db.formSubmission.create({
    data: {
      submittedValue: text,
      userId,
      holderTeamId: teamId ?? null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, clock++)),
    },
  });
  if (teamId) {
    await db.suggestedTeam.create({
      data: { formSubmissionId: row.id, teamId, reasoning: `auto ${text}` },
    });
  }
  return row;
}

const transfer = (submissionId: string, from: string | null, to: string, reason = "theirs") =>
  transferSubmission(db, { submissionId, expectedHolderTeamId: from, toTeamId: to, reason });

describe("getBoard", () => {
  it("getBoard lists every team, open cards oldest first, answered excluded", async () => {
    const { finance, support, user } = await teams();
    const older = await submission(user.id, "older", finance.id);
    const newer = await submission(user.id, "newer", finance.id);
    const done = await submission(user.id, "done", finance.id);
    await answerSubmission(db, { submissionId: done.id, expectedHolderTeamId: finance.id, body: "ok" });

    const board = await getBoard(db);

    expect(board.teams.map((t) => t.name)).toEqual(["Finance", "Sales", "Support"]);
    expect(board.teams[0]!.cards.map((c) => c.id)).toEqual([older.id, newer.id]);
    expect(board.teams.find((t) => t.id === support.id)!.cards).toEqual([]);
    expect(board.unrouted).toEqual([]);
  });

  it("getBoard puts submissions with no suggestion in unrouted", async () => {
    const { user } = await teams();
    const lost = await submission(user.id, "lost");

    const board = await getBoard(db);

    expect(board.unrouted).toMatchObject([
      { id: lost.id, text: "lost", holderTeamId: null, origin: { kind: "unrouted" } },
    ]);
    expect(board.teams.flatMap((t) => t.cards)).toEqual([]);
  });

  it('card origin is auto, then "from <team>" after a transfer', async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);
    expect((await getBoard(db)).teams.find((t) => t.id === support.id)!.cards[0]!.origin).toEqual({
      kind: "auto",
    });

    await transfer(s.id, support.id, finance.id);

    const card = (await getBoard(db)).teams.find((t) => t.id === finance.id)!.cards[0]!;
    expect(card).toMatchObject({ id: s.id, holderTeamId: finance.id });
    expect(card.origin).toEqual({ kind: "transfer", fromTeam: "Support" });
  });
});

describe("transferSubmission", () => {
  it("transfer moves the holder and records from/to/reason", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);

    await transfer(s.id, support.id, finance.id, "money back");

    expect(await db.formSubmission.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      holderTeamId: finance.id,
    });
    expect(await db.transfer.findMany()).toMatchObject([
      { formSubmissionId: s.id, fromTeamId: support.id, toTeamId: finance.id, reason: "money back" },
    ]);
  });

  it("transfer from unrouted records a null from-team", async () => {
    const { finance, user } = await teams();
    const s = await submission(user.id, "lost");

    await transfer(s.id, null, finance.id, "billing");

    expect(await db.transfer.findFirstOrThrow()).toMatchObject({ fromTeamId: null, toTeamId: finance.id });
    const board = await getBoard(db);
    expect(board.unrouted).toEqual([]);
    expect(board.teams[0]!.cards[0]!.origin).toEqual({ kind: "transfer", fromTeam: null });
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t "],
    ["5001-character", "a".repeat(5001)],
  ])("rejects %s reasons", async (_label, reason) => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);

    await expect(transfer(s.id, support.id, finance.id, reason)).rejects.toBeInstanceOf(
      BoardValidationError,
    );
    expect(await db.transfer.count()).toBe(0);
  });

  it("accepts a 5000-emoji reason", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);

    await transfer(s.id, support.id, finance.id, "😀".repeat(5000));

    expect(await db.transfer.count()).toBe(1);
  });

  it("rejects a transfer to the current holder", async () => {
    const { support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);

    await expect(transfer(s.id, support.id, support.id)).rejects.toBeInstanceOf(BoardValidationError);
  });

  it("rejects an unknown team or submission", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);

    await expect(transfer(s.id, support.id, "nope")).rejects.toBeInstanceOf(BoardValidationError);
    await expect(transfer("nope", support.id, finance.id)).rejects.toBeInstanceOf(
      BoardValidationError,
    );
  });

  it("stale expected holder → BoardConflictError, nothing written", async () => {
    const { finance, support, sales, user } = await teams();
    const s = await submission(user.id, "refund", support.id);
    await transfer(s.id, support.id, finance.id);

    await expect(transfer(s.id, support.id, sales.id)).rejects.toBeInstanceOf(BoardConflictError);
    expect(await db.transfer.count()).toBe(1);
    expect(await db.formSubmission.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      holderTeamId: finance.id,
    });
  });

  it("two concurrent transfers from the same holder: exactly one succeeds", async () => {
    const { finance, support, sales, user } = await teams();
    const s = await submission(user.id, "refund", support.id);

    const results = await Promise.allSettled([
      transfer(s.id, support.id, finance.id),
      transfer(s.id, support.id, sales.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BoardConflictError);
    expect(await db.transfer.count()).toBe(1);
  });

  it("holderMatchesHistory", async () => {
    const { finance, support, sales, user } = await teams();
    const s = await submission(user.id, "refund", support.id);
    await transfer(s.id, support.id, finance.id);
    await transfer(s.id, finance.id, sales.id);
    await transfer(s.id, sales.id, finance.id);

    const last = await db.transfer.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    const row = await db.formSubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.holderTeamId).toBe(last.toTeamId);
    expect(await db.transfer.count()).toBe(3);
  });
});

describe("answerSubmission", () => {
  it("answer sets answer/answeredAt, keeps holder, card leaves the board", async () => {
    const { finance, user } = await teams();
    const s = await submission(user.id, "refund", finance.id);

    await answerSubmission(db, {
      submissionId: s.id,
      expectedHolderTeamId: finance.id,
      body: "  Refunded.  ",
    });

    const row = await db.formSubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ holderTeamId: finance.id, answer: "Refunded.", answerBackfilled: false });
    expect(row.answeredAt).not.toBeNull();
    expect((await getBoard(db)).teams.flatMap((t) => t.cards)).toEqual([]);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
    ["5001-character", "a".repeat(5001)],
  ])("rejects %s answers", async (_label, body) => {
    const { finance, user } = await teams();
    const s = await submission(user.id, "refund", finance.id);

    await expect(
      answerSubmission(db, { submissionId: s.id, expectedHolderTeamId: finance.id, body }),
    ).rejects.toBeInstanceOf(BoardValidationError);
  });

  it("answering or transferring an answered submission → BoardConflictError", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", finance.id);
    await answerSubmission(db, { submissionId: s.id, expectedHolderTeamId: finance.id, body: "ok" });

    await expect(
      answerSubmission(db, { submissionId: s.id, expectedHolderTeamId: finance.id, body: "again" }),
    ).rejects.toBeInstanceOf(BoardConflictError);
    await expect(transfer(s.id, finance.id, support.id)).rejects.toBeInstanceOf(BoardConflictError);
    expect(await db.formSubmission.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      answer: "ok",
    });
  });

  it("answering with a stale holder → BoardConflictError", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);
    await transfer(s.id, support.id, finance.id);

    await expect(
      answerSubmission(db, { submissionId: s.id, expectedHolderTeamId: support.id, body: "ok" }),
    ).rejects.toBeInstanceOf(BoardConflictError);
  });

  it("concurrent answer and transfer: exactly one succeeds", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", finance.id);

    const results = await Promise.allSettled([
      answerSubmission(db, { submissionId: s.id, expectedHolderTeamId: finance.id, body: "ok" }),
      transfer(s.id, finance.id, support.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await db.formSubmission.findUniqueOrThrow({ where: { id: s.id } });
    const transfers = await db.transfer.count();
    // Either it was answered by Finance with no move, or moved with no answer.
    expect(
      (row.answer === "ok" && row.holderTeamId === finance.id && transfers === 0) ||
        (row.answer === null && row.holderTeamId === support.id && transfers === 1),
    ).toBe(true);
  });
});

describe("getSubmissionDetail", () => {
  it("detail trail: auto, transfers, answer in order; backfilled omits auto", async () => {
    const { finance, support, user } = await teams();
    const s = await submission(user.id, "refund", support.id);
    await transfer(s.id, support.id, finance.id, "money back");
    await answerSubmission(db, { submissionId: s.id, expectedHolderTeamId: finance.id, body: "Done." });

    const detail = await getSubmissionDetail(db, s.id);

    expect(detail).toMatchObject({
      id: s.id,
      text: "refund",
      email: "ada@example.com",
      status: "answered",
      holder: { id: finance.id, name: "Finance" },
    });
    expect(detail!.trail.map((e) => e.kind)).toEqual(["auto", "transfer", "answer"]);
    expect(detail!.trail[0]).toMatchObject({ kind: "auto", team: "Support", reasoning: "auto refund" });
    expect(detail!.trail[1]).toMatchObject({
      kind: "transfer",
      from: "Support",
      to: "Finance",
      reason: "money back",
    });
    expect(detail!.trail[2]).toMatchObject({
      kind: "answer",
      team: "Finance",
      body: "Done.",
      backfilled: false,
    });

    const labelled = await submission(user.id, "labelled", finance.id);
    await db.formSubmission.update({
      where: { id: labelled.id },
      data: { answer: "it's billing", answeredAt: new Date(), answerBackfilled: true },
    });
    const backfilled = await getSubmissionDetail(db, labelled.id);
    expect(backfilled!.trail).toMatchObject([
      { kind: "answer", team: "Finance", body: "it's billing", backfilled: true },
    ]);
  });

  it("reports open and unrouted status, and null for an unknown id", async () => {
    const { finance, user } = await teams();
    const open = await submission(user.id, "open", finance.id);
    const lost = await submission(user.id, "lost");

    expect(await getSubmissionDetail(db, open.id)).toMatchObject({ status: "open" });
    expect(await getSubmissionDetail(db, lost.id)).toMatchObject({
      status: "unrouted",
      holder: null,
      trail: [],
    });
    expect(await getSubmissionDetail(db, "nope")).toBeNull();
  });
});

describe("getAnswered", () => {
  it("getAnswered newest first with backfilled flag", async () => {
    const { finance, user } = await teams();
    const first = await submission(user.id, "first", finance.id);
    const second = await submission(user.id, "second", finance.id);
    await submission(user.id, "open", finance.id);
    await db.formSubmission.update({
      where: { id: first.id },
      data: { answer: "a", answeredAt: new Date(Date.UTC(2026, 0, 2)), answerBackfilled: true },
    });
    await db.formSubmission.update({
      where: { id: second.id },
      data: { answer: "b", answeredAt: new Date(Date.UTC(2026, 0, 3)) },
    });

    expect(await getAnswered(db)).toMatchObject([
      { id: second.id, text: "second", team: "Finance", backfilled: false },
      { id: first.id, text: "first", team: "Finance", backfilled: true },
    ]);
  });
});
