import { createDb } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { TEAMS } from "./seed-data.js";

// Seeds only an empty Team table: the database is the source of truth, so a
// team edited or deleted in Prisma Studio stays that way across restarts.
export async function seedTeams(
  db: PrismaClient,
): Promise<{ created: number; skipped: number }> {
  if ((await db.team.count()) > 0) return { created: 0, skipped: TEAMS.length };
  const { count } = await db.team.createMany({ data: [...TEAMS], skipDuplicates: true });
  return { created: count, skipped: TEAMS.length - count };
}

if (import.meta.main) {
  const db = createDb();
  try {
    const { created, skipped } = await seedTeams(db);
    console.log(`teams: created ${created}, skipped ${skipped}`);
  } finally {
    await db.$disconnect();
  }
}
