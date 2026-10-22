/**
 * @support-triage/db — Prisma client and schema shared by apps in this monorepo.
 */

export {
  answerSubmission,
  BoardConflictError,
  BoardValidationError,
  getAnswered,
  getBoard,
  getSubmissionDetail,
  transferSubmission,
} from "./board.js";
export type {
  AnsweredItem,
  Board,
  BoardCard,
  CardOrigin,
  SubmissionDetail,
  TrailEntry,
} from "./board.js";
export { createDb } from "./client.js";
export {
  EMBEDDING_DIMENSIONS,
  findNeighbours,
  getEmbedding,
  setEmbedding,
  submissionsNeedingEmbedding,
} from "./embeddings.js";
export type { Neighbour, NeighbourTransfer } from "./embeddings.js";
export { MAX_NOTE_LENGTH, MAX_SUBMISSION_LENGTH } from "./limits.js";
export {
  DEFAULT_ROUTING_GUIDANCE,
  getRoutingGuidance,
  ROUTING_GUIDANCE_KEY,
} from "./settings.js";
export type {
  FormSubmission,
  PrismaClient,
  Setting,
  SuggestedTeam,
  Team,
  Transfer,
  User,
} from "./generated/prisma/client.js";
