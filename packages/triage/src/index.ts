/**
 * @ac-1/triage — routes a request to a team: embed it, find similar
 * human-verified requests, and let Claude pick. Server-side only (needs API keys).
 */

export { EMBEDDING_MODEL, EmbeddingError, voyageEmbedder } from "./embedder.js";
export type { Embedder } from "./embedder.js";
export { requireEnv } from "./env.js";
