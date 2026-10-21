import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TEAMS } from "./seed-data.js";
import { seedTeams } from "./seed.js";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("seedTeams", () => {
  it("seedTeams creates all teams in an empty db", async () => {
    expect(await seedTeams(db)).toEqual({ created: 5, skipped: 0 });
    const ids = (await db.team.findMany({ select: { id: true } })).map((t) => t.id);
    expect(ids.sort()).toEqual(TEAMS.map((t) => t.id).sort());
  });

  it("seedTeams is a no-op on second run", async () => {
    await seedTeams(db);
    expect(await seedTeams(db)).toEqual({ created: 0, skipped: 5 });
  });

  it("seedTeams does not overwrite an edited description", async () => {
    await seedTeams(db);
    await db.team.update({
      where: { name: "Support" },
      data: { description: "edited in studio" },
    });
    await seedTeams(db);
    const support = await db.team.findUniqueOrThrow({ where: { name: "Support" } });
    expect(support.description).toBe("edited in studio");
  });

  it("seedTeams does not recreate a team deleted from the db", async () => {
    await seedTeams(db);
    await db.team.delete({ where: { name: "Agency/Channel" } });
    expect(await seedTeams(db)).toEqual({ created: 0, skipped: 5 });
    expect(await db.team.findUnique({ where: { name: "Agency/Channel" } })).toBeNull();
  });
});
