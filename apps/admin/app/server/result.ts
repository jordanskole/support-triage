import { BoardConflictError, BoardValidationError } from "@ac-1/db";

/** What a board action tells the client: done, someone got there first, or bad input. */
export type ActionResult =
  { ok: true } | { ok: false; error: "moved" | "invalid"; message: string };

/** Runs a board write and turns its expected failures into an ActionResult. */
export async function toActionResult(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    if (error instanceof BoardConflictError)
      return { ok: false, error: "moved", message: error.message };
    if (error instanceof BoardValidationError) {
      return { ok: false, error: "invalid", message: error.message };
    }
    throw error;
  }
}
