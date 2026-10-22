import { EMBEDDING_DIMENSIONS, setEmbedding } from "@support-triage/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ClassificationError, type Classifier, type ClassifyInput } from "./classifier.js";
import { evaluate } from "./eval.js";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();
const MODEL = "fake-embedder";

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

function unit(i: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i] = 1;
  return v;
}

/** Answers `team` for every request, or throws for the requests in `failOn`. */
function fakeClassifier(team: string, failOn: string[] = []) {
  const calls: ClassifyInput[] = [];
  const classifier: Classifier = {
    async classify(input) {
      calls.push(input);
      if (failOn.includes(input.request)) throw new ClassificationError("refused");
      return { team, reasoning: `picked ${team}`, usage: { inputTokens: 10, outputTokens: 2 } };
    },
  };
  return { classifier, calls };
}

/** Three answered rows: two Finance (one transferred from Support), one Support. */
async function seed() {
  const finance = await db.team.create({ data: { name: "Finance", description: "money" } });
  const support = await db.team.create({ data: { name: "Support", description: "help" } });
  const user = await db.user.create({ data: { email: "ada@example.com" } });
  const rows = [
    { text: "refund", teamId: finance.id, movedTo: undefined, axis: 0 },
    { text: "invoice", teamId: support.id, movedTo: finance.id, axis: 1 },
    { text: "login", teamId: support.id, movedTo: undefined, axis: 2 },
  ];
  const ids: Record<string, string> = {};
  for (const r of rows) {
    const s = await db.formSubmission.create({ data: { submittedValue: r.text, userId: user.id } });
    await setEmbedding(db, s.id, unit(r.axis), MODEL);
    await db.suggestedTeam.create({
      data: { formSubmissionId: s.id, teamId: r.teamId, reasoning: "auto" },
    });
    if (r.movedTo) {
      await db.transfer.create({
        data: { formSubmissionId: s.id, fromTeamId: r.teamId, toTeamId: r.movedTo, reason: "money" },
      });
    }
    await db.formSubmission.update({
      where: { id: s.id },
      data: {
        holderTeamId: r.movedTo ?? r.teamId,
        answer: `answer ${r.text}`,
        answeredAt: new Date(),
      },
    });
    ids[r.text] = s.id;
  }
  return ids;
}

describe("evaluate", () => {
  it("scores each verified submission against its effective team", async () => {
    const ids = await seed();
    const report = await evaluate(db, fakeClassifier("Finance").classifier, { model: MODEL });

    expect(report).toMatchObject({ total: 3, correct: 2, failures: [] });
    expect(report.misses).toEqual([
      { submissionId: ids.login, expected: "Support", got: "Finance", reasoning: "picked Finance" },
    ]);
    expect(report.usage).toEqual({ inputTokens: 30, outputTokens: 6 });
  });

  it("never shows a held-out row its own answer", async () => {
    await seed();
    const { classifier, calls } = fakeClassifier("Finance");
    await evaluate(db, classifier, { model: MODEL });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.neighbours.map((n) => n.text)).not.toContain(call.request);
      expect(call.neighbours.map((n) => n.answer)).not.toContain(`answer ${call.request}`);
      expect(call.neighbours).toHaveLength(2);
    }
  });

  it("ignores open submissions", async () => {
    await seed();
    const support = await db.team.findUniqueOrThrow({ where: { name: "Support" } });
    const user = await db.user.findFirstOrThrow();
    const open = await db.formSubmission.create({
      data: { submittedValue: "still open", userId: user.id, holderTeamId: support.id },
    });
    await setEmbedding(db, open.id, unit(3), MODEL);
    await db.suggestedTeam.create({
      data: { formSubmissionId: open.id, teamId: support.id, reasoning: "auto" },
    });
    const { classifier, calls } = fakeClassifier("Finance");

    const report = await evaluate(db, classifier, { model: MODEL });

    expect(report.total).toBe(3);
    expect(calls.map((c) => c.request)).not.toContain("still open");
    for (const call of calls) expect(call.neighbours.map((n) => n.text)).not.toContain("still open");
  });

  it("writes nothing", async () => {
    await seed();
    const snapshot = async () => ({
      submissions: await db.formSubmission.count(),
      suggestions: await db.suggestedTeam.count(),
      users: await db.user.count(),
      lastSuggestionUpdate: (await db.suggestedTeam.aggregate({ _max: { updatedAt: true } }))._max,
      lastSubmissionUpdate: (await db.formSubmission.aggregate({ _max: { updatedAt: true } }))._max,
    });
    const before = await snapshot();

    await evaluate(db, fakeClassifier("Support").classifier, { model: MODEL });

    expect(await snapshot()).toEqual(before);
  });

  it("records a classifier failure and continues", async () => {
    const ids = await seed();
    const report = await evaluate(db, fakeClassifier("Finance", ["invoice"]).classifier, {
      model: MODEL,
    });

    expect(report.failures).toEqual([{ submissionId: ids.invoice, error: "refused" }]);
    expect(report).toMatchObject({ total: 3, correct: 1 });
  });
});
