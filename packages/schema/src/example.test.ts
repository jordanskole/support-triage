import { describe, expect, it } from "vitest";
import { parseExample } from "./example.js";

describe("parseExample", () => {
  it("accepts a valid example", () => {
    const value = { id: "1", name: "hello", createdAt: "2026-01-01T00:00:00Z" };
    expect(parseExample(value)).toEqual(value);
  });

  it("rejects an empty name", () => {
    expect(() =>
      parseExample({ id: "1", name: "", createdAt: "2026-01-01T00:00:00Z" }),
    ).toThrow();
  });
});
