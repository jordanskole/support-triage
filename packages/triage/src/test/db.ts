import { createDb, type PrismaClient } from "@ac-1/db";

export function testDb(): PrismaClient {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set");
  return createDb(url);
}

export async function resetDb(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "SuggestedTeam", "FormSubmission", "User", "Team", "Setting" CASCADE',
  );
}
