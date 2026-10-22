import { EMBEDDING_DIMENSIONS, getEmbedding, setEmbedding } from "@ac-1/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyLabels, backfillEmbeddings } from "./backfill.js";
import type { Embedder } from "./embedder.js";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

const vector = () => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.5);

function fakeEmbedder(model = "current") {
  const calls: string[][] = [];
  const embedder: Embedder = {
    model,
    async embed(texts) {
      calls.push(texts);
      return texts.map(vector);
    },
  };
  return { embedder, calls };
}

async function seed() {
  const finance = await db.team.create({ data: { name: "Finance", description: "money" } });
  const user = await db.user.create({ data: { email: "ada@example.com" } });
  const a = await db.formSubmission.create({ data: { submittedValue: "a", userId: user.id } });
  const b = await db.formSubmission.create({ data: { submittedValue: "b", userId: user.id } });
  return { finance, a, b };
}

describe("backfillEmbeddings", () => {
  it("embeds rows without an embedding and skips current ones", async () => {
    const { a, b } = await seed();
    const { embedder, calls } = fakeEmbedder();

    expect(await backfillEmbeddings(db, embedder)).toEqual({ embedded: 2, skipped: 0 });
    expect(calls).toEqual([["a", "b"]]);
    expect((await getEmbedding(db, a.id))?.model).toBe("current");
    expect((await getEmbedding(db, b.id))?.model).toBe("current");

    expect(await backfillEmbeddings(db, embedder)).toEqual({ embedded: 0, skipped: 2 });
    expect(calls).toHaveLength(1);
  });

  it("re-embeds rows made by another model", async () => {
    const { a, b } = await seed();
    await setEmbedding(db, a.id, vector(), "old");
    await setEmbedding(db, b.id, vector(), "current");
    const { embedder, calls } = fakeEmbedder();

    expect(await backfillEmbeddings(db, embedder)).toEqual({ embedded: 1, skipped: 1 });
    expect(calls).toEqual([["a"]]);
  });
});

describe("applyLabels", () => {
  it("creates verified suggestions from labels", async () => {
    const { a } = await seed();

    expect(
      await applyLabels(db, [{ submissionId: a.id, team: "Finance", reasoning: "money" }]),
    ).toEqual({ created: 1, skipped: 0 });

    const suggestion = await db.suggestedTeam.findUniqueOrThrow({
      where: { formSubmissionId: a.id },
      include: { team: true },
    });
    expect(suggestion).toMatchObject({ hitlVerified: true, reasoning: "money" });
    expect(suggestion.team.name).toBe("Finance");
  });

  it("does not overwrite an existing suggestion", async () => {
    const { finance, a } = await seed();
    await db.suggestedTeam.create({
      data: { formSubmissionId: a.id, teamId: finance.id, reasoning: "agent pick" },
    });

    expect(
      await applyLabels(db, [{ submissionId: a.id, team: "Finance", reasoning: "human" }]),
    ).toEqual({ created: 0, skipped: 1 });
    expect(
      await db.suggestedTeam.findUniqueOrThrow({ where: { formSubmissionId: a.id } }),
    ).toMatchObject({ reasoning: "agent pick", hitlVerified: false });
  });

  it.each([
    ["an unknown team", (ids: { a: string }) => ({ submissionId: ids.a, team: "Legal" })],
    ["an unknown submission", () => ({ submissionId: "nope", team: "Finance" })],
  ])("rejects %s and writes nothing", async (_label, bad) => {
    const { a, b } = await seed();
    const labels = [
      { submissionId: b.id, team: "Finance", reasoning: "ok" },
      { reasoning: "bad", ...bad({ a: a.id }) },
    ];

    await expect(applyLabels(db, labels)).rejects.toThrow();
    expect(await db.suggestedTeam.count()).toBe(0);
  });
});
