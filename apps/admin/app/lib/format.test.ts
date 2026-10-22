import { describe, expect, it } from "vitest";
import { age, canDrop, originLabel } from "./format.js";

describe("originLabel", () => {
  it("names where a card came from without naming the model", () => {
    const labels = [
      originLabel({ kind: "auto" }),
      originLabel({ kind: "transfer", fromTeam: "Support" }),
      originLabel({ kind: "transfer", fromTeam: null }),
      originLabel({ kind: "unrouted" }),
    ];
    expect(labels).toEqual(["Auto-routed", "↪ from Support", "↪ from Unrouted", "Unrouted"]);
    for (const label of labels) expect(label).not.toMatch(/haiku|claude/i);
  });
});

describe("age", () => {
  const now = new Date(Date.UTC(2026, 9, 21, 12));
  const ago = (ms: number) => age(new Date(now.getTime() - ms), now);
  const MIN = 60_000;

  it("rounds down to the largest whole unit", () => {
    expect(ago(30_000)).toBe("just now");
    expect(ago(20 * MIN)).toBe("20m");
    expect(ago(2 * 60 * MIN + 5 * MIN)).toBe("2h");
    expect(ago(24 * 60 * MIN)).toBe("1d");
  });
});

describe("canDrop", () => {
  it("refuses the column the card is already in", () => {
    expect(canDrop({ holderTeamId: "finance" }, "finance")).toBe(false);
  });

  it("allows any other team, including from unrouted", () => {
    expect(canDrop({ holderTeamId: "finance" }, "support")).toBe(true);
    expect(canDrop({ holderTeamId: null }, "support")).toBe(true);
  });
});
