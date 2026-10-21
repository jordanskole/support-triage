import { describe, expect, it } from "vitest";
import { ImportError, mapSnapshot } from "./map.js";
import type { HygraphSnapshot } from "./types.js";

const T0 = "2026-01-01T00:00:00.000Z";

function snapshot(overrides: Partial<HygraphSnapshot> = {}): HygraphSnapshot {
  return {
    teams: [{ id: "team1", createdAt: T0, name: "Finance", description: "billing" }],
    customers: [
      { id: "cust1", createdAt: T0, firstName: null, lastName: null, email: ["ada@example.com"] },
    ],
    formSubmissions: [
      { id: "sub1", createdAt: T0, submittedValue: "my invoice is wrong", customer: { id: "cust1" } },
    ],
    suggestedTeams: [],
    ...overrides,
  };
}

const suggestion = {
  id: "sug1",
  createdAt: T0,
  reasoning: "mentions an invoice",
  hitlVerified: null,
  correctedReasoning: null,
  formSubmission: { id: "sub1" },
  team: { id: "team1" },
  correctedTeam: null,
};

function importError(s: HygraphSnapshot): ImportError {
  try {
    mapSnapshot(s);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return e as ImportError;
  }
  throw new Error("expected mapSnapshot to throw");
}

describe("mapSnapshot", () => {
  it("maps a customer to a user with a single email", () => {
    expect(mapSnapshot(snapshot()).users).toEqual([
      { id: "cust1", email: "ada@example.com", firstName: null, lastName: null, createdAt: new Date(T0) },
    ]);
  });

  it("keeps hygraph ids and createdAt", () => {
    const plan = mapSnapshot(snapshot());
    expect(plan.teams[0]).toMatchObject({ id: "team1", createdAt: new Date(T0) });
    expect(plan.formSubmissions[0]).toMatchObject({ id: "sub1", createdAt: new Date(T0) });
  });

  it("maps formSubmission.customer to userId", () => {
    expect(mapSnapshot(snapshot()).formSubmissions[0]).toEqual({
      id: "sub1",
      createdAt: new Date(T0),
      submittedValue: "my invoice is wrong",
      userId: "cust1",
    });
  });

  it("maps suggestedTeam team/correctedTeam/formSubmission to ids and defaults hitlVerified null to false", () => {
    const s = snapshot({
      teams: [
        { id: "team1", createdAt: T0, name: "Finance", description: "billing" },
        { id: "team2", createdAt: T0, name: "Sales", description: "buying" },
      ],
      suggestedTeams: [{ ...suggestion, correctedTeam: { id: "team2" }, correctedReasoning: "upsell" }],
    });
    expect(mapSnapshot(s).suggestedTeams).toEqual([
      {
        id: "sug1",
        createdAt: new Date(T0),
        reasoning: "mentions an invoice",
        hitlVerified: false,
        correctedReasoning: "upsell",
        formSubmissionId: "sub1",
        teamId: "team1",
        correctedTeamId: "team2",
      },
    ]);
  });

  it("throws ImportError naming the customer id when email list is empty", () => {
    const s = snapshot({
      customers: [{ id: "cust1", createdAt: T0, firstName: null, lastName: null, email: [] }],
    });
    expect(importError(s).message).toContain("cust1");
  });

  it("throws ImportError naming the customer id when email list has 2+ entries", () => {
    const s = snapshot({
      customers: [
        { id: "cust1", createdAt: T0, firstName: null, lastName: null, email: ["a@example.com", "b@example.com"] },
      ],
    });
    expect(importError(s).message).toContain("cust1");
  });

  it("throws ImportError naming both ids when two customers share an email", () => {
    const s = snapshot({
      customers: [
        { id: "cust1", createdAt: T0, firstName: null, lastName: null, email: ["ada@example.com"] },
        { id: "cust2", createdAt: T0, firstName: null, lastName: null, email: ["ada@example.com"] },
      ],
    });
    const { message } = importError(s);
    expect(message).toContain("cust1");
    expect(message).toContain("cust2");
  });

  it("throws ImportError naming the submission id when submittedValue is null or blank", () => {
    for (const submittedValue of [null, "   "]) {
      const s = snapshot({
        formSubmissions: [{ id: "sub1", createdAt: T0, submittedValue, customer: { id: "cust1" } }],
      });
      expect(importError(s).message).toContain("sub1");
    }
  });

  it("throws ImportError naming the submission id when customer is null", () => {
    const s = snapshot({
      formSubmissions: [{ id: "sub1", createdAt: T0, submittedValue: "hi", customer: null }],
    });
    expect(importError(s).message).toContain("sub1");
  });

  it("throws ImportError naming the team id when name or description is null", () => {
    for (const team of [
      { id: "team1", createdAt: T0, name: null, description: "billing" },
      { id: "team1", createdAt: T0, name: "Finance", description: null },
    ]) {
      expect(importError(snapshot({ teams: [team] })).message).toContain("team1");
    }
  });

  it("throws ImportError when a suggestedTeam has no team, no formSubmission, or null reasoning", () => {
    for (const bad of [{ team: null }, { formSubmission: null }, { reasoning: null }]) {
      const s = snapshot({ suggestedTeams: [{ ...suggestion, ...bad }] });
      expect(importError(s).message).toContain("sug1");
    }
  });

  it("reports every bad record in one error", () => {
    const s = snapshot({
      teams: [{ id: "team1", createdAt: T0, name: null, description: "billing" }],
      formSubmissions: [{ id: "sub1", createdAt: T0, submittedValue: null, customer: { id: "cust1" } }],
    });
    const { message } = importError(s);
    expect(message).toContain("team1");
    expect(message).toContain("sub1");
  });
});
