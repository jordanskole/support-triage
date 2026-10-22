import { describe, expect, it } from "vitest";
import { age, canDrop, originLabel, trailTitle, transferTargets } from "./format.js";

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

describe("trailTitle", () => {
  const at = new Date();

  it("titles each kind of trail entry", () => {
    expect(trailTitle({ kind: "auto", team: "Support", reasoning: "r", at })).toBe(
      "Auto-routed to Support",
    );
    expect(trailTitle({ kind: "transfer", from: "Support", to: "Finance", reason: "r", at })).toBe(
      "Support → Finance",
    );
    expect(trailTitle({ kind: "transfer", from: null, to: "Finance", reason: "r", at })).toBe(
      "Unrouted → Finance",
    );
    expect(trailTitle({ kind: "answer", team: "Finance", body: "b", backfilled: false, at })).toBe(
      "Answered by Finance",
    );
  });
});

describe("transferTargets", () => {
  const teams = [
    { id: "a", name: "Agency" },
    { id: "f", name: "Finance" },
    { id: "s", name: "Support" },
  ];

  it("offers every team except the holder, in the given order", () => {
    expect(transferTargets(teams, "f").map((t) => t.id)).toEqual(["a", "s"]);
  });

  it("offers every team for an unrouted request", () => {
    expect(transferTargets(teams, null)).toEqual(teams);
  });
});
