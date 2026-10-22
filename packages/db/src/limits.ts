/**
 * Longest `FormSubmission.submittedValue` we accept, in characters (code points,
 * the way Postgres counts VARCHAR). Lowering it also needs a migration for the
 * `@db.VarChar(5000)` column in schema.prisma.
 */
export const MAX_SUBMISSION_LENGTH = 5000;

/**
 * Longest transfer reason or answer we accept, counted the same way. The
 * `Transfer.reason` and `FormSubmission.answer` columns are `@db.VarChar(5000)`.
 */
export const MAX_NOTE_LENGTH = 5000;
