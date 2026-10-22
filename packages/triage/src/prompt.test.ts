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
      answer: "Refunded you.",
      backfilled: false,
      transfers: [{ from: "Support", to: "Finance", reason: "money back" }],
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

  it("user includes each neighbour's text, answering team, answer and moves, then the request last", () => {
    const { user } = buildPrompt(input);
    expect(user).toContain("I was charged twice");
    expect(user).toContain("Answered by: Finance");
    expect(user).toContain("Answer sent to the customer");
    expect(user).toContain("Refunded you.");
    expect(user).toContain("Support → Finance");
    expect(user).toContain("money back");
    expect(user).toContain("0.83");
    expect(user.trimEnd().endsWith("Can I get a refund?")).toBe(true);
  });

  it("labels a backfilled answer as a reviewer's routing note", () => {
    const neighbour = { ...input.neighbours[0]!, backfilled: true, transfers: [] };
    const { user } = buildPrompt({ ...input, neighbours: [neighbour] });
    expect(user).toContain("Reviewer's routing note");
    expect(user).not.toContain("Answer sent to the customer");
  });

  it("names an unrouted start as Unrouted", () => {
    const neighbour = {
      ...input.neighbours[0]!,
      transfers: [{ from: null, to: "Finance", reason: "billing" }],
    };
    expect(buildPrompt({ ...input, neighbours: [neighbour] }).user).toContain("Unrouted → Finance");
  });

  it("says there are no past requests when neighbours is empty", () => {
    const { user } = buildPrompt({ ...input, neighbours: [] });
    expect(user).toContain("no past requests");
  });
});
