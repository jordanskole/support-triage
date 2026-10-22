import { EMBEDDING_DIMENSIONS } from "@ac-1/db";

/** Turns text into vectors. `model` is stored next to each vector it produces. */
export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_MODEL = "voyage-4";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export class EmbeddingError extends Error {
  override name = "EmbeddingError";
}

type VoyageResponse = { data: { index: number; embedding: number[] }[] };

export function voyageEmbedder(opts: {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}): Embedder {
  const model = opts.model ?? EMBEDDING_MODEL;
  const doFetch = opts.fetch ?? fetch;

  return {
    model,
    async embed(texts) {
      const response = await doFetch(VOYAGE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: texts,
          model,
          // Every submission is stored and searched with the same vector.
          input_type: "document",
          output_dimension: EMBEDDING_DIMENSIONS,
          // Over-long text is rejected before it gets here; never embed a cut-off version.
          truncation: false,
        }),
      });
      if (!response.ok) {
        throw new EmbeddingError(`Voyage returned ${response.status}: ${await response.text()}`);
      }

      const { data } = (await response.json()) as VoyageResponse;
      const vectors = [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== texts.length) {
        throw new EmbeddingError(`Voyage returned ${vectors.length} vectors for ${texts.length} texts`);
      }
      for (const vector of vectors) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingError(
            `Voyage returned a vector of ${vector.length} numbers, expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
      }
      return vectors;
    },
  };
}
