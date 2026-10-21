import { describe, expect, it } from "vitest";
import { fetchHygraphSnapshot, readHygraphConfig } from "./fetch.js";

const config = { endpoint: "https://hygraph.test/v2/x/master", token: "tok" };

type Body = { query: string; variables: { first: number; skip: number } };

// Answers each model's paged query from `pages`; records every request.
function fakeFetch(pages: Record<string, unknown[][]>) {
  const calls: { headers: Record<string, string>; body: Body }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    calls.push({ headers: init.headers as Record<string, string>, body });
    const field = /\{\s*(\w+)\s*\(/.exec(body.query)?.[1] ?? "";
    const page = pages[field]?.[body.variables.skip / body.variables.first] ?? [];
    return new Response(JSON.stringify({ data: { [field]: page } }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("readHygraphConfig", () => {
  it("readHygraphConfig throws naming HYGRAPH_ENDPOINT when blank", () => {
    expect(() => readHygraphConfig({ HYGRAPH_ENDPOINT: "", HYGRAPH_TOKEN: "x" })).toThrow(
      /HYGRAPH_ENDPOINT/,
    );
  });

  it("readHygraphConfig throws naming HYGRAPH_TOKEN when missing", () => {
    expect(() => readHygraphConfig({ HYGRAPH_ENDPOINT: "https://e" })).toThrow(/HYGRAPH_TOKEN/);
  });

  it("returns endpoint and token", () => {
    expect(readHygraphConfig({ HYGRAPH_ENDPOINT: "https://e", HYGRAPH_TOKEN: "t" })).toEqual({
      endpoint: "https://e",
      token: "t",
    });
  });
});

describe("fetchHygraphSnapshot", () => {
  it("fetchHygraphSnapshot sends bearer token and stage DRAFT", async () => {
    const { impl, calls } = fakeFetch({});
    await fetchHygraphSnapshot(config, impl);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer tok");
      expect(call.body.query).toContain("stage: DRAFT");
    }
  });

  it("fetchHygraphSnapshot pages", async () => {
    const sub = (i: number) => ({ id: `sub${i}`, createdAt: "2026-01-01T00:00:00Z", submittedValue: "x", customer: null });
    const { impl, calls } = fakeFetch({
      formSubmissions: [
        Array.from({ length: 100 }, (_, i) => sub(i)),
        Array.from({ length: 7 }, (_, i) => sub(100 + i)),
      ],
    });
    const snapshot = await fetchHygraphSnapshot(config, impl);
    expect(snapshot.formSubmissions).toHaveLength(107);
    const skips = calls.filter((c) => c.body.query.includes("formSubmissions")).map((c) => c.body.variables.skip);
    expect(skips).toEqual([0, 100]);
  });

  it("fetchHygraphSnapshot throws on graphql errors", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "field 'x' is not defined" }], data: null }))) as unknown as typeof fetch;
    await expect(fetchHygraphSnapshot(config, impl)).rejects.toThrow(/field 'x' is not defined/);
  });

  it("throws on a non-2xx response", async () => {
    const impl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(fetchHygraphSnapshot(config, impl)).rejects.toThrow(/401/);
  });
});
