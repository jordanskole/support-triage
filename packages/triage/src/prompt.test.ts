import { describe, expect, it } from "vitest";
import type { ClassifyInput } from "./classifier.js";
import { buildPrompt } from "./prompt.js";

const input: ClassifyInput = {
  request: "Can I get a refund?",
  guidance: "Prefer the team that must act first.",
  teams: [
    { name: "Support", description: "Help using the product." },
    { name: "Finance", description: "Billing, refunds and invoices." },
  ],
  neighbours: [
    {
      submissionId: "s1",
      text: "I was charged twice",
      team: "Finance",
      reasoning: "Duplicate charge is billing.",
      similarity: 0.8312,
    },
  ],
};

describe("buildPrompt", () => {
  it("system lists every team name and description", () => {
    const { system } = buildPrompt(input);
    for (const team of input.teams) {
      expect(system).toContain(team.name);
      expect(system).toContain(team.description);
    }
  });

  it("system includes the routing guidance", () => {
    expect(buildPrompt(input).system).toContain("Prefer the team that must act first.");
  });

  it("user includes each neighbour's text, team and reasoning, then the request last", () => {
    const { user } = buildPrompt(input);
    expect(user).toContain("I was charged twice");
    expect(user).toContain("Finance");
    expect(user).toContain("Duplicate charge is billing.");
    expect(user).toContain("0.83");
    expect(user.trimEnd().endsWith("Can I get a refund?")).toBe(true);
  });

  it("says there are no past decisions when neighbours is empty", () => {
    const { user } = buildPrompt({ ...input, neighbours: [] });
    expect(user).toContain("no past decisions");
  });
});
