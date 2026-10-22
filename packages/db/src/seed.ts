import { createDb } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { TEAMS } from "./seed-data.js";
import { DEFAULT_SETTINGS } from "./settings.js";

// Seeds only an empty Team table: the database is the source of truth, so a
// team edited or deleted in Prisma Studio stays that way across restarts.
export async function seedTeams(
  db: PrismaClient,
): Promise<{ created: number; skipped: number }> {
  if ((await db.team.count()) > 0) return { created: 0, skipped: TEAMS.length };
  const { count } = await db.team.createMany({ data: [...TEAMS], skipDuplicates: true });
  return { created: count, skipped: TEAMS.length - count };
}

// Creates settings that don't exist yet and never overwrites one, so edits in
// Prisma Studio stick. A deleted setting comes back with its default.
export async function seedSettings(
  db: PrismaClient,
): Promise<{ created: number; skipped: number }> {
  const { count } = await db.setting.createMany({ data: DEFAULT_SETTINGS, skipDuplicates: true });
  return { created: count, skipped: DEFAULT_SETTINGS.length - count };
}

if (import.meta.main) {
  const db = createDb();
  try {
    const { created, skipped } = await seedTeams(db);
    console.log(`teams: created ${created}, skipped ${skipped}`);
    const settings = await seedSettings(db);
    console.log(`settings: created ${settings.created}, skipped ${settings.skipped}`);
  } finally {
    await db.$disconnect();
  }
}
