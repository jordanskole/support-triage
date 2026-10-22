import type { PrismaClient } from "./generated/prisma/client.js";

/** Length of `FormSubmission.embedding`; matches `vector(1024)` in schema.prisma. */
export const EMBEDDING_DIMENSIONS = 1024;

/** A past, human-verified submission that is close to the one being triaged. */
export type Neighbour = {
  submissionId: string;
  text: string;
  /** `correctedTeam` if a human corrected the pick, otherwise `team`. */
  team: string;
  /** `correctedReasoning` if set, otherwise `reasoning`. */
  reasoning: string;
  /** Cosine similarity to the query, 1 = same direction. */
  similarity: number;
};

function toVectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `expected an embedding of ${EMBEDDING_DIMENSIONS} numbers, got ${vector.length}`,
    );
  }
  return `[${vector.join(",")}]`;
}

export async function setEmbedding(
  db: PrismaClient,
  submissionId: string,
  vector: number[],
  model: string,
): Promise<void> {
  const literal = toVectorLiteral(vector);
  await db.$executeRaw`
    UPDATE "FormSubmission"
    SET "embedding" = ${literal}::vector, "embeddingModel" = ${model}
    WHERE "id" = ${submissionId}`;
}

export async function getEmbedding(
  db: PrismaClient,
  submissionId: string,
): Promise<{ vector: number[]; model: string } | null> {
  const rows = await db.$queryRaw<{ embedding: string; embeddingModel: string }[]>`
    SELECT "embedding"::text AS "embedding", "embeddingModel"
    FROM "FormSubmission"
    WHERE "id" = ${submissionId} AND "embedding" IS NOT NULL`;
  const row = rows[0];
  if (!row) return null;
  return { vector: JSON.parse(row.embedding) as number[], model: row.embeddingModel };
}

/**
 * The `k` verified submissions closest to `vector`, nearest first. Only rows
 * embedded with the same `model` are compared.
 */
export async function findNeighbours(
  db: PrismaClient,
  opts: { vector: number[]; model: string; k: number; excludeSubmissionId?: string },
): Promise<Neighbour[]> {
  const literal = toVectorLiteral(opts.vector);
  const exclude = opts.excludeSubmissionId ?? "";
  return db.$queryRaw<Neighbour[]>`
    SELECT
      fs."id" AS "submissionId",
      fs."submittedValue" AS "text",
      COALESCE(ct."name", t."name") AS "team",
      COALESCE(st."correctedReasoning", st."reasoning") AS "reasoning",
      1 - (fs."embedding" <=> ${literal}::vector) AS "similarity"
    FROM "FormSubmission" fs
    JOIN "SuggestedTeam" st ON st."formSubmissionId" = fs."id"
    JOIN "Team" t ON t."id" = st."teamId"
    LEFT JOIN "Team" ct ON ct."id" = st."correctedTeamId"
    WHERE st."hitlVerified"
      AND fs."embedding" IS NOT NULL
      AND fs."embeddingModel" = ${opts.model}
      AND fs."id" <> ${exclude}
    ORDER BY fs."embedding" <=> ${literal}::vector
    LIMIT ${opts.k}`;
}

/** Submissions with no embedding, or one made by a different model. */
export async function submissionsNeedingEmbedding(
  db: PrismaClient,
  model: string,
): Promise<{ id: string; submittedValue: string }[]> {
  return db.$queryRaw`
    SELECT "id", "submittedValue"
    FROM "FormSubmission"
    WHERE "embedding" IS NULL OR "embeddingModel" IS DISTINCT FROM ${model}
    ORDER BY "createdAt"`;
}
