import type { PrismaClient } from "./generated/prisma/client.js";

/** The triage agent's instructions for weighing past decisions against team descriptions. */
export const ROUTING_GUIDANCE_KEY = "routingGuidance";

export const DEFAULT_ROUTING_GUIDANCE = [
  "Choose the single team that should act on the request first.",
  "The team descriptions define each team's job. The past decisions show how a human reviewer drew the lines between teams, so follow them when a past request is clearly the same kind of request, even if the wording differs.",
  "A past decision that only shares words or a topic with the new request is weak evidence; fall back to the descriptions.",
  "If a request touches several teams, route it by its main ask.",
  "In your reasoning, say in one or two sentences why this team fits, written so it still makes sense to someone who hasn't seen the past decisions.",
].join(" ");

/** Every setting with the value a fresh database starts with. */
export const DEFAULT_SETTINGS = [{ key: ROUTING_GUIDANCE_KEY, value: DEFAULT_ROUTING_GUIDANCE }];

/** The stored routing guidance, or the default if the row is missing. */
export async function getRoutingGuidance(db: PrismaClient): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: ROUTING_GUIDANCE_KEY } });
  return row?.value ?? DEFAULT_ROUTING_GUIDANCE;
}
