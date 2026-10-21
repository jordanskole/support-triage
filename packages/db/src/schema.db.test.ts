import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

async function submissionWithSuggestion() {
  const team = await db.team.create({ data: { name: "Support", description: "help" } });
  const user = await db.user.create({ data: { email: "ada@example.com" } });
  const submission = await db.formSubmission.create({
    data: { submittedValue: "my invoice is wrong", userId: user.id },
  });
  const suggestion = await db.suggestedTeam.create({
    data: { formSubmissionId: submission.id, teamId: team.id, reasoning: "billing" },
  });
  return { team, user, submission, suggestion };
}

describe("schema constraints", () => {
  it("rejects a second team with the same name", async () => {
    await db.team.create({ data: { name: "Support", description: "a" } });
    await expect(
      db.team.create({ data: { name: "Support", description: "b" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a second user with the same email", async () => {
    await db.user.create({ data: { email: "ada@example.com" } });
    await expect(
      db.user.create({ data: { email: "ada@example.com" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deleting a form submission deletes its suggested team", async () => {
    const { submission } = await submissionWithSuggestion();
    await db.formSubmission.delete({ where: { id: submission.id } });
    expect(await db.suggestedTeam.count()).toBe(0);
  });

  it("deleting a team referenced by a suggestion is blocked", async () => {
    const { team } = await submissionWithSuggestion();
    await expect(db.team.delete({ where: { id: team.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("hitlVerified defaults to false", async () => {
    const { suggestion } = await submissionWithSuggestion();
    expect(suggestion.hitlVerified).toBe(false);
  });
});
