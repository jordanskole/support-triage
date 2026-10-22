import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Replays the migrations in a scratch schema so the board migration's data
// mapping can be checked against rows in the old shape.
const BOARD = "20261022020000_board";
const SCHEMA = "mig_test";
const dir = new URL("../prisma/migrations/", import.meta.url);
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const sql = (name: string) => readFileSync(new URL(`${name}/migration.sql`, dir), "utf8");

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error("DATABASE_URL_TEST is not set");
const client = new pg.Client({ connectionString: url, options: `-c search_path=${SCHEMA},public` });

beforeAll(async () => {
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
  for (const name of migrations.filter((m) => m < BOARD)) await client.query(sql(name));

  await client.query(`
    INSERT INTO "Team" (id, "updatedAt", name, description) VALUES
      ('A', now(), 'A', 'a'), ('B', now(), 'B', 'b');
    INSERT INTO "User" (id, "updatedAt", email) VALUES ('u', now(), 'u@example.com');
    INSERT INTO "FormSubmission" (id, "updatedAt", "submittedValue", "userId") VALUES
      ('s1', now(), 'one', 'u'), ('s2', now(), 'two', 'u'),
      ('s3', now(), 'three', 'u'), ('s4', now(), 'four', 'u');
    INSERT INTO "SuggestedTeam"
      (id, "updatedAt", "formSubmissionId", "teamId", reasoning, "hitlVerified", "correctedTeamId", "correctedReasoning")
    VALUES
      ('g1', now(), 's1', 'A', 'r1', true, NULL, NULL),
      ('g2', now(), 's2', 'A', 'r2', true, 'B', 'c2'),
      ('g3', now(), 's3', 'A', 'auto3', false, NULL, NULL);
  `);
  await client.query(sql(BOARD));
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

async function submission(id: string) {
  const { rows } = await client.query(
    `SELECT "holderTeamId", answer, "answeredAt", "answerBackfilled" FROM "FormSubmission" WHERE id = $1`,
    [id],
  );
  return rows[0];
}

describe(`migration ${BOARD}`, () => {
  it("turns a verified suggestion into a backfilled answer held by its team", async () => {
    const s1 = await submission("s1");
    expect(s1).toMatchObject({ holderTeamId: "A", answer: "r1", answerBackfilled: true });
    expect(s1.answeredAt).not.toBeNull();
  });

  it("uses the corrected team and reasoning, and moves the pick to the corrected team", async () => {
    expect(await submission("s2")).toMatchObject({
      holderTeamId: "B",
      answer: "c2",
      answerBackfilled: true,
    });
    const { rows } = await client.query(`SELECT "teamId" FROM "SuggestedTeam" WHERE id = 'g2'`);
    expect(rows[0].teamId).toBe("B");
  });

  it("leaves an unverified suggestion open, held by its suggested team", async () => {
    expect(await submission("s3")).toMatchObject({
      holderTeamId: "A",
      answer: null,
      answeredAt: null,
      answerBackfilled: false,
    });
  });

  it("leaves a submission with no suggestion unrouted", async () => {
    expect(await submission("s4")).toMatchObject({ holderTeamId: null, answer: null });
  });

  it("creates an empty Transfer table and drops the verification columns", async () => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "Transfer"`);
    expect(rows[0].n).toBe(0);
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'SuggestedTeam'`,
      [SCHEMA],
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain("hitlVerified");
    expect(names).not.toContain("correctedTeamId");
    expect(names).not.toContain("correctedReasoning");
  });
});
