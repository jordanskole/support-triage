# Triage RAG pipeline: design

**Date:** 2026-10-21
**Status:** Draft, awaiting approval

## Why

ac-1 routes free-text requests ("How can I help?") to one of five teams. The routing is the product. This round builds the pipeline that makes the routing decision, end to end, without the web form:

1. A user submits a request.
2. A `FormSubmission` is created.
3. The request is embedded (turned into a vector).
4. The closest past submissions that a human has already labelled are found by vector similarity.
5. Claude picks a team, using the team descriptions and those labelled neighbours, and writes its reasoning. The pick is saved as a `SuggestedTeam`.

Retrieval matters because the hard cases sit on team boundaries: upgrades between Sales and Finance, an agency's how-to question between Support and Agency/Channel. Team descriptions alone don't settle these, and past human decisions do. **The owner expects Haiku to get things wrong at first and to improve as the pool of verified examples grows.** This round is about building that loop and measuring where it starts. Hitting an accuracy bar is not the goal.

## Decisions made with the owner

- **LLM:** the Anthropic API called directly through the official SDK (`@anthropic-ai/sdk`), not through a provider or gateway. The model is **Claude Haiku 5.5 (`claude-haiku-5-5`)**. Changing the model later should be a one-line change.
- **Embeddings:** **Voyage AI**, because Anthropic has no embeddings API. A local model was considered and dropped. Embeddings from different models can't be compared, so a second provider would mean re-embedding everything whenever the provider changed. There is no local fallback.
- **Keys:** `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` in the root `.env`. Both are already set. Both go into `.env.example` as empty slots.
- **Neighbour's team:** a matched submission counts as `correctedTeam` if set, otherwise `team`. A human correction outranks the original pick.
- **Interface this round:** a **CLI script**. The web form and the "where does the agent run" server question stay on the roadmap.
- **Existing data gets labelled.** The owner supplied the correct team for all 15 existing submissions (below). They become the starting pool of verified examples.

## Current state (verified 2026-10-21)

- The Postgres container (`postgres:18-alpine`) is running. The database holds 5 teams, 1 user, 15 submissions, and **0** `SuggestedTeam`s.
- `@ac-1/db` exports `createDb()` and the model types. There is no pipeline code yet.
- `FormSubmission` has no embedding column, and the Postgres image has no `pgvector`.

## Goals

1. **Schema:** `FormSubmission` gets a nullable 1024-dimension vector column and a nullable `embeddingModel` string recording which model produced the vector. A migration enables the `vector` extension. Prisma can't query vectors natively, so the column is `Unsupported("vector(1024)")`, and similarity search is one raw SQL query that lives in `@ac-1/db`.
2. **Postgres image:** change `postgres:18-alpine` to a pgvector build of Postgres 18 (for example `pgvector/pgvector:pg18`; the builder verifies the tag). This applies in compose and wherever the test database comes from. `docker compose up` on a fresh clone must still work with no manual steps.
   - **The local data must survive the image swap (Claude's call).** The 15 submissions and 1 user exist **only** in the local `pgdata` volume. The Hygraph import has been deleted, and the Hygraph project is being shut down. The pgvector images are Debian/glibc and the current image is Alpine/musl, so reusing the data directory in place risks collation mismatches on text indexes.
   - Procedure:
     1. Take a `pg_dump` of the `ac1` database **before** the swap, and keep it outside git (for example in `.superpowers/`).
     2. Start the new image on a fresh volume.
     3. Restore the dump.
     4. Apply the new migration.
     5. Check that the counts are still 5 / 1 / 15.
   - Removing the old volume is a destructive step. Confirm it with the owner first, and only after the dump has been checked to restore cleanly.
3. **A new package `packages/triage` (`@ac-1/triage`)** owns the pipeline, following the existing package conventions (ESM, `tsc`, Vitest). It is split so the CLI is a thin shell over a function a server can call later:
   - an **embedder** (Voyage) behind a small interface;
   - a **classifier** (Claude) behind a small interface;
   - **`triage(...)`**, which runs steps 2–5 against the database through injected embedder and classifier.
4. **CLI:** `npm run triage -- "<request text>" --email <email>` (exact flag names are left to the builder). It:
   - finds or creates the `User` by exact email, matching the existing convention of no trim and no lowercasing;
   - embeds the text with Voyage;
   - saves the `FormSubmission` with its embedding;
   - retrieves the nearest labelled neighbours;
   - asks Claude for a team and reasoning;
   - saves a `SuggestedTeam` with `hitlVerified: false`;
   - prints the chosen team, the reasoning, and the neighbours used (team plus similarity score).
5. **Backfill (run once by hand):** a script that
   - embeds every `FormSubmission` whose embedding is null or was made by a model other than the current one, so the same script re-embeds after a model change;
   - and, given a labels file, creates a `SuggestedTeam` with `hitlVerified: true` for each listed submission.

   It is idempotent: it skips rows that are already embedded with the current model, and it does not overwrite existing suggestions.
6. **Eval script:** leave-one-out over every verified submission. For each one, it excludes that submission from retrieval, reuses its stored embedding (so no Voyage call is needed), asks Claude for a team, and compares the answer with the human label. It prints:
   - a score out of N;
   - each miss (submission id, expected team, got team, reasoning);
   - total token usage.

   **It writes nothing to the database.** It is a baseline to track over time, not a pass/fail gate.
7. README, `.env.example`, and turbo's env passthrough are updated for the new keys, the package, and the commands.

## How the pieces behave

**Retrieval.**
- The pool is submissions that have an embedding from the current model **and** a `SuggestedTeam` with `hitlVerified: true`. The submission being triaged is never in its own results.
- Ranking is by cosine distance. The top K results are taken, with K about 5 and set by the builder as a constant.
- Each neighbour carries its submission text, its effective team (`correctedTeam ?? team`), its effective reasoning (`correctedReasoning ?? reasoning`), and its similarity score.
- There is no vector index at this size. An exact scan is fine.

**Classification.**
- Claude is given:
  - all teams with their descriptions, read from the database and never hard-coded;
  - the neighbours, presented as past human decisions;
  - the new request.
- Claude returns `{ team, reasoning }` through structured output, where `team` is constrained to the current team names. An answer that matches no team is impossible by construction. If the constraint is ever violated anyway, the code treats it as an error.
- When there are zero neighbours (an empty pool), the classifier still runs, using descriptions alone.

**Failure handling (Claude's call).**
- The order is: embed, then save the submission with its embedding, then classify, then save the suggestion.
- If Voyage fails, nothing is saved.
- If Claude fails, refuses, or hits `max_tokens`, the submission stays saved without a suggestion. The CLI exits non-zero, prints the submission id, and leaves no partial `SuggestedTeam` behind.
- Both API keys are checked at startup with a clear error.

**Testing.**
- `npm test` must never call Voyage or Anthropic, so unit tests use stand-in embedder and classifier implementations.
- Retrieval and the `triage(...)` database flow are covered by `*.db.test.ts` tests against the test database, using hand-made vectors.
- Real API calls happen only in the CLI, the backfill, and the eval, all of which are run by hand.

## The 15 labels

The owner's labels map one-to-one, in `createdAt` order, onto the existing rows (checked against the database on 2026-10-21):

| Rows (by `createdAt`) | Team |
|---|---|
| 1–3 | Support |
| 4–6 | Sales |
| 7–9 | Finance |
| 10–12 | Product |
| 13–15 | Agency/Channel |

Six of them are deliberate boundary cases: Sales #2, Sales #3, Finance #2, Product #3, Agency #2, and Agency #3. The owner's notes on those (for example, "a quote is buying, vendor paperwork is paying") become their `reasoning`. The other nine get a short one-line reason.

**Where the notes are:** the owner's full notes for all 15 rows are saved in the git-ignored file `.superpowers/triage-label-notes.md`.
- The six ⚠️ rationales are the owner's words. Use them as `reasoning`, lightly edited into sentences if needed.
- The other nine reasons are Claude's call, written from the owner's one-line descriptions.

**The labels file holds submission ids, team names, and reasoning that paraphrases real submissions. It is git-ignored and never committed,** following the same rule as the Hygraph import. Claude writes it from the owner's notes and shows the id → team pairing to the owner before the backfill runs.

## Non-goals

- The web form, a server or API, and the answer to "where does the agent run".
- A local embedding model, or a fallback between providers.
- Confidence thresholds, a fallback team, or a human review queue for uncertain picks.
- Re-triaging a submission whose classification failed. Running the CLI again creates a new submission. This is acceptable for a CLI round.
- Notifying the team, or anything about how a routed request reaches it.
- Vector indexes (HNSW or IVFFlat), and tuning for scale.
- Prompt optimisation against the eval. This round produces the baseline.

## Anti-goals

- `npm test` or CI spending money or needing API keys.
- Real submission text or the labels file committed to the repo.
- API keys reaching the browser bundle (`apps/web` must not import `@ac-1/triage`).
- Team descriptions or team names hard-coded in the prompt.
- Comparing vectors made by different embedding models.

## Constraints

- `@anthropic-ai/sdk` and the Voyage client (official SDK or plain HTTP, the builder's choice) are pinned to stable releases, not release candidates, using the same caution as with Prisma 8's RC on `latest`.
- The builder checks Voyage's current general-purpose model and its output size at build time. The column is 1024-dimensional on the assumption that the chosen model outputs 1024 numbers. If it doesn't, the column follows the model.
- Embed each submission once, as a document, and reuse that vector both for storage and for its own search (Claude's call). This keeps backfill and eval free of extra Voyage calls.
- Node ≥ 24, npm workspaces, Turborepo, and Prisma 7.10.x, as already in use.

## Done means

1. `docker compose up` from a clean volume still brings everything up, now on the pgvector image, with the migration applied.
2. The backfill, run against the local database, embeds all 15 submissions and creates 15 verified suggestions. Running it again changes nothing.
3. `npm run triage -- "<text>" --email <email>` prints a team, reasoning, and neighbours, and creates a `User` (if new), a `FormSubmission` with an embedding, and an unverified `SuggestedTeam`.
4. The eval prints a score out of 15 with the misses listed, and the database is unchanged afterwards.
5. `npm run build`, `npm run typecheck`, `npm test`, and `test:db` pass, and `npm test` does so with the API keys unset.

## Left to the builder

- CLI flag names.
- The prompt wording.
- The exact K.
- The Voyage client choice.
- File layout inside `packages/triage`.
- How the labels file is shaped and passed to the backfill.
- The turbo task wiring.
- Whether unverified agent suggestions should be shown anywhere in the CLI output.
