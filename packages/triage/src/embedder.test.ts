import { describe, expect, it } from "vitest";
import { EmbeddingError, voyageEmbedder } from "./embedder.js";

const A = new Array<number>(1024).fill(0.1);
const B = new Array<number>(1024).fill(0.2);

function stubFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function ok(data: { index: number; embedding: number[] }[]) {
  return new Response(JSON.stringify({ object: "list", data, usage: { total_tokens: 7 } }), {
    status: 200,
  });
}

describe("voyageEmbedder", () => {
  it("sends model, document input type, 1024 dimensions and no truncation", async () => {
    const { fetch, calls } = stubFetch(ok([{ index: 0, embedding: A }, { index: 1, embedding: B }]));
    const embedder = voyageEmbedder({ apiKey: "k", fetch });

    await embedder.embed(["a", "b"]);

    expect(embedder.model).toBe("voyage-4");
    expect(calls[0]!.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer k");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      input: ["a", "b"],
      model: "voyage-4",
      input_type: "document",
      output_dimension: 1024,
      truncation: false,
    });
  });

  it("returns embeddings in input order", async () => {
    const { fetch } = stubFetch(ok([{ index: 1, embedding: B }, { index: 0, embedding: A }]));
    const result = await voyageEmbedder({ apiKey: "k", fetch }).embed(["a", "b"]);
    expect(result).toEqual([A, B]);
  });

  it("throws EmbeddingError with status and body on non-2xx", async () => {
    const { fetch } = stubFetch(new Response("bad key", { status: 401 }));
    const embed = voyageEmbedder({ apiKey: "k", fetch }).embed(["a"]);
    await expect(embed).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embed).rejects.toThrow(/401.*bad key/);
  });

  it("throws EmbeddingError when a vector is not 1024 long", async () => {
    const { fetch } = stubFetch(ok([{ index: 0, embedding: [1, 2, 3] }]));
    await expect(voyageEmbedder({ apiKey: "k", fetch }).embed(["a"])).rejects.toBeInstanceOf(
      EmbeddingError,
    );
  });
});
