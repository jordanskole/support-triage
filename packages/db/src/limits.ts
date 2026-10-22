/**
 * Longest `FormSubmission.submittedValue` we accept, in characters (code points,
 * the way Postgres counts VARCHAR). Lowering it also needs a migration for the
 * `@db.VarChar(5000)` column in schema.prisma.
 */
export const MAX_SUBMISSION_LENGTH = 5000;
