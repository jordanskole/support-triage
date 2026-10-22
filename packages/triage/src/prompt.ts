import type { ClassifyInput } from "./classifier.js";

export function buildPrompt(input: ClassifyInput): { system: string; user: string } {
  const teams = input.teams.map((t) => `## ${t.name}\n${t.description}`).join("\n\n");
  const system = [
    "You route incoming customer requests to the one team that should handle them.",
    "# Teams",
    teams,
    "# How to decide",
    input.guidance,
  ].join("\n\n");

  const past =
    input.neighbours.length === 0
      ? "There are no past requests similar to this one yet."
      : input.neighbours
          .map((n, i) =>
            [
              `### Request ${i + 1} (similarity ${n.similarity.toFixed(2)})`,
              `Answered by: ${n.team}`,
              ...n.transfers.map((t) => `Moved: ${t.from ?? "Unrouted"} → ${t.to}: ${t.reason}`),
              n.backfilled ? "Reviewer's routing note:" : "Answer sent to the customer:",
              n.answer,
              "Request:",
              n.text,
            ].join("\n"),
          )
          .join("\n\n");
  const user = [
    "# Past requests a team answered",
    past,
    "# New request",
    input.request,
  ].join("\n\n");

  return { system, user };
}
