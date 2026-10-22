import { BoardConflictError, BoardValidationError } from "@support-triage/db";
import { describe, expect, it } from "vitest";
import { toActionResult } from "./result.js";

describe("toActionResult", () => {
  it("reports success", async () => {
    expect(await toActionResult(async () => {})).toEqual({ ok: true });
  });

  it("turns a conflict into a moved result", async () => {
    expect(
      await toActionResult(async () => {
        throw new BoardConflictError();
      }),
    ).toEqual({ ok: false, error: "moved", message: "This request moved." });
  });

  it("turns a validation error into an invalid result with its message", async () => {
    expect(
      await toActionResult(async () => {
        throw new BoardValidationError("too long");
      }),
    ).toEqual({ ok: false, error: "invalid", message: "too long" });
  });

  it("rethrows anything else", async () => {
    await expect(
      toActionResult(async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
  });
});
