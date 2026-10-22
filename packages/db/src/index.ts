/**
 * @ac-1/db — Prisma client and schema shared by apps in this monorepo.
 */

export { createDb } from "./client.js";
export {
  EMBEDDING_DIMENSIONS,
  findNeighbours,
  getEmbedding,
  setEmbedding,
  submissionsNeedingEmbedding,
} from "./embeddings.js";
export type { Neighbour } from "./embeddings.js";
export { MAX_SUBMISSION_LENGTH } from "./limits.js";
export type {
  FormSubmission,
  PrismaClient,
  SuggestedTeam,
  Team,
  User,
} from "./generated/prisma/client.js";
