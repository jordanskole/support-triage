-- pgvector: the image ships it; the migration turns it on per database.
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "embedding" vector(1024),
ADD COLUMN     "embeddingModel" TEXT,
ALTER COLUMN "submittedValue" SET DATA TYPE VARCHAR(5000);

