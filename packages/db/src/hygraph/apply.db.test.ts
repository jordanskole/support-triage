import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TEAMS } from "../seed-data.js";
import { seedTeams } from "../seed.js";
import { resetDb, testDb } from "../test/db.js";
import { applyImport } from "./apply.js";
import type { ImportPlan } from "./map.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

const T0 = new Date("2026-01-01T00:00:00Z");

const plan: ImportPlan = {
  teams: [{ id: "team1", createdAt: T0, name: "Finance", description: "billing" }],
  users: [{ id: "user1", createdAt: T0, email: "ada@example.com", firstName: null, lastName: null }],
  formSubmissions: [
    { id: "sub1", createdAt: T0, submittedValue: "my invoice is wrong", userId: "user1" },
    { id: "sub2", createdAt: T0, submittedValue: "refund please", userId: "user1" },
  ],
  suggestedTeams: [
    { id: "sug1", createdAt: T0, reasoning: "invoice", formSubmissionId: "sub1", teamId: "team1" },
  ],
};

describe("applyImport", () => {
  it("applyImport into an empty db returns counts", async () => {
    expect(await applyImport(db, plan)).toEqual({
      teams: 1,
      users: 1,
      formSubmissions: 2,
      suggestedTeams: 1,
    });
    const sub = await db.formSubmission.findUniqueOrThrow({ where: { id: "sub1" } });
    expect(sub.createdAt).toEqual(T0);
  });

  it("applyImport is idempotent", async () => {
    const first = await applyImport(db, plan);
    const before = await db.formSubmission.findUniqueOrThrow({ where: { id: "sub1" } });
    expect(await applyImport(db, plan)).toEqual(first);
    const after = await db.formSubmission.findUniqueOrThrow({ where: { id: "sub1" } });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("applyImport into a seeded db matches teams by id", async () => {
    await seedTeams(db);
    const seededPlan: ImportPlan = {
      teams: TEAMS.map((t) => ({ ...t })),
      users: [],
      formSubmissions: [],
      suggestedTeams: [],
    };
    await expect(applyImport(db, seededPlan)).resolves.toMatchObject({ teams: 5 });
  });

  it("leaves an edited team description alone", async () => {
    await seedTeams(db);
    await db.team.update({ where: { name: "Support" }, data: { description: "edited in studio" } });
    await applyImport(db, { teams: TEAMS.map((t) => ({ ...t })), users: [], formSubmissions: [], suggestedTeams: [] });
    const support = await db.team.findUniqueOrThrow({ where: { name: "Support" } });
    expect(support.description).toBe("edited in studio");
  });
});
