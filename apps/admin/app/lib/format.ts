import type { CardOrigin, TrailEntry } from "@support-triage/db";

/** Where a card came from, in words that never name the model. */
export function originLabel(origin: CardOrigin): string {
  switch (origin.kind) {
    case "auto":
      return "Auto-routed";
    case "transfer":
      return `↪ from ${origin.fromTeam ?? "Unrouted"}`;
    case "unrouted":
      return "Unrouted";
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago `from` was, in the largest whole unit. */
export function age(from: Date, now: Date): string {
  const ms = now.getTime() - from.getTime();
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** A card can be dropped on any column except the one holding it. */
export function canDrop(card: { holderTeamId: string | null }, targetTeamId: string): boolean {
  return card.holderTeamId !== targetTeamId;
}

/** The headline for one step in a submission's trail. */
export function trailTitle(entry: TrailEntry): string {
  switch (entry.kind) {
    case "auto":
      return `Auto-routed to ${entry.team}`;
    case "transfer":
      return `${entry.from ?? "Unrouted"} → ${entry.to}`;
    case "answer":
      return `Answered by ${entry.team}`;
  }
}

/** The teams a request can be transferred to: all but the one holding it. */
export function transferTargets<T extends { id: string }>(
  teams: T[],
  holderTeamId: string | null,
): T[] {
  return teams.filter((t) => t.id !== holderTeamId);
}
