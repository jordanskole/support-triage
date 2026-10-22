import { EMBEDDING_DIMENSIONS, ROUTING_GUIDANCE_KEY, setEmbedding } from "@support-triage/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ClassificationError, type Classifier, type ClassifyInput } from "./classifier.js";
import type { Embedder } from "./embedder.js";
import { resetDb, testDb } from "./test/db.js";
import { SubmissionRejectedError, triage, TriageFailedError } from "./triage.js";

const db = testDb();
const MODEL = "fake-embedder";

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

function unit(i: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i] = 1;
  return v;
}

function fakeEmbedder(opts: { fail?: boolean } = {}) {
  const calls: string[][] = [];
  const embedder: Embedder = {
    model: MODEL,
    async embed(texts) {
      calls.push(texts);
      if (opts.fail) throw new Error("voyage down");
      return texts.map(() => unit(0));
    },
  };
  return { embedder, calls };
}

function fakeClassifier(opts: { team?: string; fail?: boolean } = {}) {
  const calls: ClassifyInput[] = [];
  const classifier: Classifier = {
    async classify(input) {
      calls.push(input);
      if (opts.fail) throw new ClassificationError("refused");
      return {
        team: opts.team ?? "Finance",
        reasoning: "it's billing",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  return { classifier, calls };
}

/** Two teams and one verified, embedded past submission. */
async function seed() {
  const finance = await db.team.create({ data: { name: "Finance", description: "money" } });
  await db.team.create({ data: { name: "Support", description: "help" } });
  const past = await db.user.create({ data: { email: "past@example.com" } });
  const neighbour = await db.formSubmission.create({
    data: { submittedValue: "charged twice", userId: past.id },
  });
  await setEmbedding(db, neighbour.id, unit(0), MODEL);
  await db.suggestedTeam.create({
    data: { formSubmissionId: neighbour.id, teamId: finance.id, reasoning: "duplicate charge" },
  });
  await db.formSubmission.update({
    where: { id: neighbour.id },
    data: {
      holderTeamId: finance.id,
      answer: "duplicate charge",
      answeredAt: new Date(),
      answerBackfilled: true,
    },
  });
  return { finance };
}

const counts = async () => ({
  users: await db.user.count(),
  submissions: await db.formSubmission.count(),
  suggestions: await db.suggestedTeam.count(),
});

describe("triage", () => {
  it("saves submission, embedding and an unverified suggestion", async () => {
    await seed();
    const { embedder } = fakeEmbedder();
    const { classifier } = fakeClassifier();

    const result = await triage(db, { embedder, classifier }, {
      text: "refund please",
      email: "ada@example.com",
    });

    expect(result.team).toBe("Finance");
    const suggestion = await db.suggestedTeam.findUniqueOrThrow({
      where: { formSubmissionId: result.submissionId },
      include: { team: true, formSubmission: true },
    });
    expect(suggestion).toMatchObject({ reasoning: "it's billing" });
    expect(suggestion.team.name).toBe("Finance");
    expect(suggestion.formSubmission).toMatchObject({
      submittedValue: "refund please",
      embeddingModel: MODEL,
    });
  });

  it("sets the holder to the suggested team and leaves it unanswered", async () => {
    const { finance } = await seed();
    const deps = { embedder: fakeEmbedder().embedder, classifier: fakeClassifier().classifier };

    const result = await triage(db, deps, { text: "refund please", email: "ada@example.com" });

    expect(
      await db.formSubmission.findUniqueOrThrow({ where: { id: result.submissionId } }),
    ).toMatchObject({ holderTeamId: finance.id, answer: null, answeredAt: null });
  });

  it("never shows the board an unrouted submission while it is being classified", async () => {
    await seed();
    let unroutedDuringClassify = -1;
    const classifier: Classifier = {
      async classify() {
        unroutedDuringClassify = await db.formSubmission.count({ where: { holderTeamId: null } });
        return { team: "Finance", reasoning: "billing", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    await triage(db, { embedder: fakeEmbedder().embedder, classifier }, {
      text: "refund please",
      email: "ada@example.com",
    });

    expect(unroutedDuringClassify).toBe(0);
  });

  it("passes DB teams and the answered neighbour to the classifier", async () => {
    await seed();
    const { embedder } = fakeEmbedder();
    const { classifier, calls } = fakeClassifier();

    const result = await triage(db, { embedder, classifier }, {
      text: "refund please",
      email: "ada@example.com",
    });

    expect(calls[0]!.teams.map((t) => t.name).sort()).toEqual(["Finance", "Support"]);
    expect(calls[0]!.request).toBe("refund please");
    expect(calls[0]!.neighbours.map((n) => n.text)).toEqual(["charged twice"]);
    expect(result.neighbours.map((n) => n.text)).toEqual(["charged twice"]);
  });

  it("passes the routing guidance stored in the database", async () => {
    await seed();
    await db.setting.create({ data: { key: ROUTING_GUIDANCE_KEY, value: "edited guidance" } });
    const { classifier, calls } = fakeClassifier();

    await triage(db, { embedder: fakeEmbedder().embedder, classifier }, {
      text: "refund please",
      email: "ada@example.com",
    });

    expect(calls[0]!.guidance).toBe("edited guidance");
  });

  it("reuses an existing user by email", async () => {
    await seed();
    const deps = { embedder: fakeEmbedder().embedder, classifier: fakeClassifier().classifier };
    await triage(db, deps, { text: "one", email: "ada@example.com" });
    await triage(db, deps, { text: "two", email: "ada@example.com" });

    expect(await db.user.count({ where: { email: "ada@example.com" } })).toBe(1);
    expect(await counts()).toMatchObject({ submissions: 3 });
  });

  it("handles concurrent first submissions from the same new email", async () => {
    await seed();
    const deps = { embedder: fakeEmbedder().embedder, classifier: fakeClassifier().classifier };

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        triage(db, deps, { text: `request ${i}`, email: "burst@example.com" }),
      ),
    );

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await db.user.count({ where: { email: "burst@example.com" } })).toBe(1);
    expect(await db.formSubmission.count({ where: { user: { email: "burst@example.com" } } })).toBe(12);
  });

  it("rejects text over 5000 characters without calling the embedder", async () => {
    await seed();
    const { embedder, calls } = fakeEmbedder();
    const before = await counts();

    await expect(
      triage(db, { embedder, classifier: fakeClassifier().classifier }, {
        text: "a".repeat(5001),
        email: "ada@example.com",
      }),
    ).rejects.toBeInstanceOf(SubmissionRejectedError);
    expect(calls).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it("accepts 5000 emoji, which Postgres counts as 5000 characters", async () => {
    await seed();
    const deps = { embedder: fakeEmbedder().embedder, classifier: fakeClassifier().classifier };
    const text = "😀".repeat(5000);

    const result = await triage(db, deps, { text, email: "ada@example.com" });

    const row = await db.formSubmission.findUniqueOrThrow({ where: { id: result.submissionId } });
    expect(row.submittedValue).toBe(text);
  });

  it.each(["", "   \n\t "])("rejects empty or whitespace-only text %j", async (text) => {
    await seed();
    const { embedder, calls } = fakeEmbedder();
    await expect(
      triage(db, { embedder, classifier: fakeClassifier().classifier }, {
        text,
        email: "ada@example.com",
      }),
    ).rejects.toBeInstanceOf(SubmissionRejectedError);
    expect(calls).toEqual([]);
  });

  it("saves nothing when the embedder fails", async () => {
    await seed();
    const before = await counts();
    await expect(
      triage(db, { embedder: fakeEmbedder({ fail: true }).embedder, classifier: fakeClassifier().classifier }, {
        text: "refund please",
        email: "new@example.com",
      }),
    ).rejects.toThrow(/voyage down/);
    expect(await counts()).toEqual(before);
  });

  it("keeps the submission but no suggestion when the classifier fails", async () => {
    await seed();
    const before = await counts();

    const error = await triage(
      db,
      { embedder: fakeEmbedder().embedder, classifier: fakeClassifier({ fail: true }).classifier },
      { text: "refund please", email: "ada@example.com" },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TriageFailedError);
    const { submissionId } = error as TriageFailedError;
    expect(await db.formSubmission.findUnique({ where: { id: submissionId } })).not.toBeNull();
    expect(await counts()).toEqual({
      users: before.users + 1,
      submissions: before.submissions + 1,
      suggestions: before.suggestions,
    });
  });
});
