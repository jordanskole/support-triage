import { createDb } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { TEAMS } from "./seed-data.js";

// Create-only: the database is the source of truth for teams, so an existing
// row (for example one edited in Prisma Studio) is never touched.
export async function seedTeams(
  db: PrismaClient,
): Promise<{ created: number; skipped: number }> {
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
