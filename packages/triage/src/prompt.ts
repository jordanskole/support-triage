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
      ? "There are no past decisions similar to this request yet."
      : input.neighbours
          .map(
            (n, i) =>
              `### Decision ${i + 1} (similarity ${n.similarity.toFixed(2)})\n` +
              `Team: ${n.team}\nWhy: ${n.reasoning}\nRequest:\n${n.text}`,
          )
          .join("\n\n");
  const user = [
    "# Past decisions made by a human reviewer",
    past,
    "# New request",
    input.request,
  ].join("\n\n");

  return { system, user };
}
