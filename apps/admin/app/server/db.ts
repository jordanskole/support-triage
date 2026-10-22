import { createDb, type PrismaClient } from "@ac-1/db";

let db: PrismaClient | undefined;

/** One Prisma client per server process, created on first use. */
export function getDb(): PrismaClient {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    db = createDb(url);
  }
  return db;
}
