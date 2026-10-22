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
    verified?: boolean;
    vector?: number[];
    model?: string;
    reasoning?: string;
    correctedTeamId?: string;
    correctedReasoning?: string;
  },
) {
  const row = await db.formSubmission.create({
    data: { submittedValue: text, userId: opts.userId },
  });
  if (opts.vector) await setEmbedding(db, row.id, opts.vector, opts.model ?? MODEL);
  if (opts.teamId) {
    await db.suggestedTeam.create({
      data: {
        formSubmissionId: row.id,
        teamId: opts.teamId,
        reasoning: opts.reasoning ?? `why ${text}`,
        hitlVerified: opts.verified ?? true,
        correctedTeamId: opts.correctedTeamId,
        correctedReasoning: opts.correctedReasoning,
      },
    });
  }
  return row;
}

describe("findNeighbours", () => {
  it("returns verified neighbours nearest first", async () => {
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
    expect(result[0]).toMatchObject({ text: "first", team: "Support", reasoning: "why first" });
    expect(result[0]!.similarity).toBeCloseTo(1);
  });

  it("uses correctedTeam and correctedReasoning when set", async () => {
    const { support, sales, user } = await fixtures();
    await submission("upgrade", {
      userId: user.id,
      teamId: support.id,
      vector: unit(0),
      correctedTeamId: sales.id,
      correctedReasoning: "it's an upgrade",
    });

    const [n] = await findNeighbours(db, { vector: unit(0), model: MODEL, k: 5 });

    expect(n).toMatchObject({ team: "Sales", reasoning: "it's an upgrade" });
  });

  it("skips unverified, unembedded, other-model and excluded rows", async () => {
    const { support, user } = await fixtures();
    await submission("unverified", {
      userId: user.id,
      teamId: support.id,
      vector: unit(0),
      verified: false,
    });
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
