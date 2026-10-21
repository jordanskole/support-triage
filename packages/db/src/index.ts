/**
 * @ac-1/db — Prisma client and schema shared by apps in this monorepo.
 */

export { createDb } from "./client.js";
export type {
  FormSubmission,
  PrismaClient,
  SuggestedTeam,
  Team,
  User,
} from "./generated/prisma/client.js";
