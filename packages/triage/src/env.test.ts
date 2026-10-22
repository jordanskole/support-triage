import { describe, expect, it } from "vitest";
import { requireEnv } from "./env.js";

describe("requireEnv", () => {
  it("names every missing variable and none of the present ones", () => {
    expect(() => requireEnv(["A", "B"], { A: "1" })).toThrow(/B/);
    expect(() => requireEnv(["A", "B"], { A: "1" })).not.toThrow(/\bA\b/);
  });

  it("treats an empty value as missing", () => {
    expect(() => requireEnv(["A"], { A: "" })).toThrow(/A/);
  });

  it("returns the values when all are set", () => {
    expect(requireEnv(["A", "B"], { A: "1", B: "2" })).toEqual({ A: "1", B: "2" });
  });
});
