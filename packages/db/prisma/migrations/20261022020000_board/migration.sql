-- Transfers and answers replace single-reviewer verification. A submission is
-- held by a team (the automatic pick, then each transfer's to-team) until that
-- team answers it. Verified suggestions become backfilled answers.

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "answer" VARCHAR(5000),
ADD COLUMN     "answerBackfilled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "holderTeamId" TEXT;

-- Data: a corrected pick moves to the corrected team, so the holder still
-- equals the pick when there are no transfers.
UPDATE "SuggestedTeam"
SET "teamId" = COALESCE("correctedTeamId", "teamId")
WHERE "hitlVerified";

-- Data: every routed submission is held by its pick's team.
UPDATE "FormSubmission" fs
SET "holderTeamId" = st."teamId"
FROM "SuggestedTeam" st
WHERE st."formSubmissionId" = fs."id";

-- Data: a human-verified pick becomes a backfilled answer from the human's text.
UPDATE "FormSubmission" fs
SET "answer" = COALESCE(st."correctedReasoning", st."reasoning"),
    "answeredAt" = st."updatedAt",
    "answerBackfilled" = true
FROM "SuggestedTeam" st
WHERE st."formSubmissionId" = fs."id" AND st."hitlVerified";

-- An answer comes with its time, and only a held submission can be answered.
ALTER TABLE "FormSubmission"
  ADD CONSTRAINT "FormSubmission_answer_check" CHECK (("answer" IS NULL) = ("answeredAt" IS NULL)),
  ADD CONSTRAINT "FormSubmission_answer_holder_check" CHECK ("answer" IS NULL OR "holderTeamId" IS NOT NULL);

-- DropForeignKey
ALTER TABLE "SuggestedTeam" DROP CONSTRAINT "SuggestedTeam_correctedTeamId_fkey";

-- AlterTable
ALTER TABLE "SuggestedTeam" DROP COLUMN "correctedReasoning",
DROP COLUMN "correctedTeamId",
DROP COLUMN "hitlVerified";

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(5000) NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "fromTeamId" TEXT,
    "toTeamId" TEXT NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transfer_formSubmissionId_createdAt_idx" ON "Transfer"("formSubmissionId", "createdAt");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_holderTeamId_fkey" FOREIGN KEY ("holderTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toTeamId_fkey" FOREIGN KEY ("toTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
