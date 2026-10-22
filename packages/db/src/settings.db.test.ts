import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROUTING_GUIDANCE, getRoutingGuidance, ROUTING_GUIDANCE_KEY } from "./settings.js";
import { seedSettings } from "./seed.js";
import { resetDb, testDb } from "./test/db.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("seedSettings", () => {
  it("creates the routing guidance with its default", async () => {
    expect(await seedSettings(db)).toEqual({ created: 1, skipped: 0 });
    expect(
      await db.setting.findUniqueOrThrow({ where: { key: ROUTING_GUIDANCE_KEY } }),
    ).toMatchObject({ value: DEFAULT_ROUTING_GUIDANCE });
  });

  it("does not overwrite an edited value", async () => {
    await seedSettings(db);
    await db.setting.update({ where: { key: ROUTING_GUIDANCE_KEY }, data: { value: "edited" } });

    expect(await seedSettings(db)).toEqual({ created: 0, skipped: 1 });
    expect(await getRoutingGuidance(db)).toBe("edited");
  });
});

describe("getRoutingGuidance", () => {
  it("falls back to the default when the row is missing", async () => {
    expect(await getRoutingGuidance(db)).toBe(DEFAULT_ROUTING_GUIDANCE);
  });
});
