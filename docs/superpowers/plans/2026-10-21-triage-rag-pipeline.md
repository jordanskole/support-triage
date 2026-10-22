# Triage RAG Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI pipeline that saves a request, embeds it with Voyage, retrieves the nearest human-verified past requests from pgvector, and has Claude Haiku pick a team with reasoning. The pipeline also gets a backfill for the 15 existing rows and a leave-one-out eval.

**Architecture:** Vector storage and search live in `@ac-1/db`. Prisma can't express vector queries, so that is raw SQL behind typed helpers. A new `@ac-1/triage` package holds the Voyage embedder and the Claude classifier, each behind a small interface, plus the `triage()` flow and three thin CLIs. Tests inject fakes, so `npm test` never calls a paid API.

**Tech Stack:** Postgres 18 + pgvector 0.8.7, Prisma 7.10, `@anthropic-ai/sdk` 1.x (`messages.parse` + `zodOutputFormat`), zod 4, the Voyage REST API through `fetch`, Vitest 5, and Node 24.

**Spec:** `docs/superpowers/specs/2026-10-21-triage-rag-pipeline-design.md`

## Global Constraints

- LLM: `claude-haiku-5-5`, called through `@anthropic-ai/sdk` directly. The model name lives in one constant.
- Embeddings: Voyage `voyage-4`, `output_dimension: 1024`, `input_type: "document"`, `truncation: false`. Each submission is embedded once and that vector is reused for search.
- Keys: `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` from the root `.env`, checked at CLI startup with a clear error.
- `submittedValue` is capped at **5,000 characters**. Both `@db.VarChar(5000)` and a pre-API check enforce it. Over-long text is rejected and never truncated. The cap is one exported constant.
- Neighbour pool: an embedding from the current model **and** `hitlVerified = true`. The team is `correctedTeam ?? team` and the reasoning is `correctedReasoning ?? reasoning`. The submission is never its own neighbour. K = 5. Cosine distance, no index.
- Team names and descriptions are always read from the DB, never hard-coded.
- `npm test` never calls Voyage or Anthropic and passes with both keys unset.
- Real submission text and the labels file never go into git. Real data lives only in `.superpowers/` (git-ignored) and the database.
- Pin `@anthropic-ai/sdk` with `~1.1.0` and zod with `^4.6.7` (the version already used in `@ac-1/schema`). No RCs.
- `apps/web` must not import `@ac-1/triage`.

## Review Focus

1. **Non-BMP text and the cap.** Postgres `VARCHAR(n)` counts code points, but JS `.length` counts UTF-16 units. A 5,000-emoji request must be accepted, and the check must use `[...text].length`. Tested in Task 5.
2. **Empty or whitespace-only requests** must be rejected before any API call, rather than embedding an empty string. Tested in Task 5.
3. **An embedding from a different model** must never be compared. The neighbour query filters on `embeddingModel`. Tested in Task 2.
4. **A Claude refusal, `max_tokens` stop, null parse, or unknown team** must raise `ClassificationError`. The submission stays saved and no `SuggestedTeam` row is created. Tested in Tasks 4 and 5.
5. **A returning email** must reuse the existing `User`, not crash on the unique index. Tested in Task 5.

---

### Task 1: Move Postgres to pgvector without losing the local data

**Files:**
- Modify: `docker-compose.yml` (postgres `image`, volume name)

**Interfaces:**
- Produces: a running `pgvector/pgvector:0.8.7-pg18-trixie` Postgres on the same port and credentials, holding the same 5 teams, 1 user and 15 submissions.

Ruling carried from the spec: instead of deleting the old volume, compose switches to a **new named volume `pgvector-data`**. The old `pgdata` volume stays untouched as a second backup, so nothing destructive happens in this task. The owner can `docker volume rm` it later.

- [ ] **Step 1: Dump the current database**

Run: `mkdir -p .superpowers/backups && docker compose exec -T postgres pg_dump -U ac1 -d ac1 --format=custom > .superpowers/backups/ac1-2026-10-21.dump && ls -l .superpowers/backups`
Expected: a non-empty `.dump` file. `git status` does not list it.

- [ ] **Step 2: Change the compose image and volume**

Set `image: pgvector/pgvector:0.8.7-pg18-trixie`, and change the postgres volume mount and the top-level `volumes:` key from `pgdata` to `pgvector-data`. Keep the mount path `/var/lib/postgresql` and the init.sql mount.

- [ ] **Step 3: Start the new database and restore**

Run: `docker compose up -d postgres`, wait for healthy, then `docker compose exec -T postgres pg_restore -U ac1 -d ac1 --no-owner < .superpowers/backups/ac1-2026-10-21.dump`
Expected: exit 0. `ac1_test` exists because init.sql ran on the fresh volume.

- [ ] **Step 4: Verify counts and the extension**

Run: `docker compose exec -T postgres psql -U ac1 -d ac1 -Atc 'SELECT (SELECT count(*) FROM "Team"),(SELECT count(*) FROM "User"),(SELECT count(*) FROM "FormSubmission"),(SELECT count(*) FROM "SuggestedTeam"); SELECT name FROM pg_available_extensions WHERE name='"'"'vector'"'"''`
Expected: `5|1|15|0` and `vector`.

- [ ] **Step 5: Verify the stack still comes up**

Run: `docker compose up -d --build && docker compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}'`
Expected: postgres running, migrate exited 0, web running.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(docker): run Postgres on the pgvector image"
```

---

### Task 2: Schema: embedding columns, length cap, vector helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (FormSubmission)
- Create: `packages/db/prisma/migrations/<timestamp>_embeddings/migration.sql` (generated with `--create-only`, then edited)
- Create: `packages/db/src/limits.ts`, `packages/db/src/embeddings.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/test/db.ts` (no change needed unless new tables)
- Test: `packages/db/src/embeddings.db.test.ts`, extend `packages/db/src/schema.db.test.ts`

**Interfaces:**
- Produces, exported from `@ac-1/db`:
  - `MAX_SUBMISSION_LENGTH = 5000`
  - `EMBEDDING_DIMENSIONS = 1024`
  - `type Neighbour = { submissionId: string; text: string; team: string; reasoning: string; similarity: number }`
  - `setEmbedding(db: PrismaClient, submissionId: string, vector: number[], model: string): Promise<void>`. Throws if `vector.length !== EMBEDDING_DIMENSIONS`.
  - `findNeighbours(db: PrismaClient, opts: { vector: number[]; model: string; k: number; excludeSubmissionId?: string }): Promise<Neighbour[]>`. Ordered by similarity, descending. `similarity = 1 - (embedding <=> query)`.
  - `submissionsNeedingEmbedding(db: PrismaClient, model: string): Promise<{ id: string; submittedValue: string }[]>`. Returns rows whose embedding is null or whose `embeddingModel` differs from `model`.
  - `getEmbedding(db: PrismaClient, submissionId: string): Promise<{ vector: number[]; model: string } | null>`. The eval uses it.

- [ ] **Step 1: Write the failing tests**

In `embeddings.db.test.ts`, use `testDb()`/`resetDb()`, two teams, one user, and a helper `unit(i)` that returns a 1024-length vector with a 1 at index `i`, plus `mix(i, j, w)` for vectors in between. Tests:
- `findNeighbours returns verified neighbours nearest first`: three verified submissions at `unit(0)`, `mix(0,1,0.5)` and `unit(1)`. Querying `unit(0)` with k=2 gives the ids in order [first, second], and `similarity` of the first is close to 1.
- `findNeighbours uses correctedTeam and correctedReasoning when set`: the neighbour's `team` and `reasoning` are the corrected values.
- `findNeighbours skips unverified, unembedded, other-model and excluded rows`: one row with `hitlVerified:false`, one with no embedding, one embedded with model `"other"`, and the excluded id itself. The result is `[]`.
- `setEmbedding rejects a vector of the wrong length`: `unit(0).slice(1)` rejects with `/1024/`.
- `submissionsNeedingEmbedding returns null and other-model rows only`.

In `schema.db.test.ts`, add `submittedValue over 5000 characters is rejected by the database`: `"a".repeat(5001)` rejects, and `"a".repeat(5000)` succeeds.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -w @ac-1/db`
Expected: FAIL. The imports from `./embeddings.js` don't exist yet, and the 5001 insert succeeds.

- [ ] **Step 3: Schema + migration**

On `FormSubmission`:
- change `submittedValue` to `String @db.VarChar(5000)`;
- add `embedding Unsupported("vector(1024)")?`;
- add `embeddingModel String?`.

Run `npx prisma migrate dev --create-only --name embeddings` from `packages/db`. Prepend `CREATE EXTENSION IF NOT EXISTS vector;` to the generated SQL, then apply it with `npx prisma migrate dev`.

- [ ] **Step 4: Implement `limits.ts` and `embeddings.ts`**

Use `$executeRaw`/`$queryRaw` tagged templates, passing the vector as a `'[x,y,...]'` string cast with `::vector`. `findNeighbours` joins `SuggestedTeam` and `Team` twice: once for team and once for the corrected team (`LEFT JOIN`), and it uses `COALESCE` for the team and reasoning. Export everything from `index.ts`.

- [ ] **Step 5: Run to verify they pass**

Run: `npm run test:db -w @ac-1/db && npm run typecheck -w @ac-1/db`
Expected: PASS. That is the existing 9 tests plus the new ones.

- [ ] **Step 6: Apply to the dev DB and commit**

Run: `npm run db:deploy -w @ac-1/db`. Expected: the migration applies, and the counts are still `5|1|15|0`.

```bash
git add packages/db
git commit -m "feat(db): pgvector embeddings on FormSubmission and a 5000-character cap"
```

---

### Task 3: `@ac-1/triage` package and the Voyage embedder

**Files:**
- Create: `packages/triage/{package.json,tsconfig.json,vitest.config.ts}`, `packages/triage/src/{index.ts,embedder.ts,env.ts}`, `packages/triage/src/test/db.ts`
- Test: `packages/triage/src/embedder.test.ts`, `packages/triage/src/env.test.ts`
- Modify: `Dockerfile` (add `COPY packages/triage/package.json packages/triage/`), `turbo.json` (`globalPassThroughEnv` += `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`), `.env.example` (add `ANTHROPIC_API_KEY=` and `VOYAGE_API_KEY=` under a `# Triage` heading)

**Interfaces:**
- Consumes: `EMBEDDING_DIMENSIONS` from `@ac-1/db`.
- Produces:
  - `interface Embedder { readonly model: string; embed(texts: string[]): Promise<number[][]> }`
  - `EMBEDDING_MODEL = "voyage-4"`
  - `voyageEmbedder(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): Embedder`
  - `class EmbeddingError extends Error`
  - `requireEnv(names: string[], env = process.env): Record<string, string>`. Throws one error that lists every missing name.
  - `src/test/db.ts`: `testDb()`, which wraps `createDb(process.env.DATABASE_URL_TEST)`, and `resetDb(db)`, the same TRUNCATE as in `@ac-1/db`.

Package conventions copy `@ac-1/db`: ESM, `tsc`, `"test": "vitest run --coverage --exclude 'src/**/*.db.test.ts'"`, and `"test:db": "node ../db/scripts/with-test-db.mjs vitest run .db.test.ts"`. Dependencies are `@ac-1/db` (`*`), `@anthropic-ai/sdk ~1.1.0`, and `zod ^4.6.7`. **`vitest.config.ts` loads the root `.env` and then deletes `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` from `process.env`**, so an accidental real client in a test fails loudly instead of spending money.

- [ ] **Step 1: Write the failing tests**

`embedder.test.ts` uses a stub `fetch` that records its call and returns `{ data: [{ index: 1, embedding: B }, { index: 0, embedding: A }], usage: { total_tokens: 7 } }`:
- `sends model, document input type, 1024 dimensions and no truncation`: URL `https://api.voyageai.com/v1/embeddings`; header `Authorization: Bearer k`; body `{ input: ["a","b"], model: "voyage-4", input_type: "document", output_dimension: 1024, truncation: false }`.
- `returns embeddings in input order`: `[A, B]`, even though the response came out of order.
- `throws EmbeddingError with status and body on non-2xx`: a 401 response with text `"bad key"` gives a rejection matching `/401.*bad key/`.
- `throws EmbeddingError when a vector is not 1024 long`.

`env.test.ts`: `requireEnv(["A","B"], { A: "1" })` throws `/B/` and not `/A/`. With both present, it returns both values.

- [ ] **Step 2: Run to verify they fail**

Run: `npm install && npm test -w @ac-1/triage`
Expected: FAIL on missing modules.

- [ ] **Step 3: Implement `embedder.ts` and `env.ts`**

Map `data` by `index`. The real REST response shape is `{ data: [{ embedding, index }], usage }`, but confirm it against https://docs.voyageai.com/reference/embeddings-api before relying on it, and record a ruling if it differs. The server never sees a request over the batch limit at this size, so send one request per `embed` call.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w @ac-1/triage && npm run typecheck -w @ac-1/triage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/triage package-lock.json Dockerfile turbo.json .env.example
git commit -m "feat(triage): package scaffold and Voyage embedder"
```

---

### Task 4: The Claude classifier

**Files:**
- Create: `packages/triage/src/classifier.ts`, `packages/triage/src/prompt.ts`
- Test: `packages/triage/src/classifier.test.ts`, `packages/triage/src/prompt.test.ts`

**Interfaces:**
- Consumes: `Neighbour` from `@ac-1/db`.
- Produces:
  - `TRIAGE_MODEL = "claude-haiku-5-5"`
  - `type ClassifyInput = { request: string; teams: { name: string; description: string }[]; neighbours: Neighbour[] }`
  - `type Classification = { team: string; reasoning: string; usage: { inputTokens: number; outputTokens: number } }`
  - `interface Classifier { classify(input: ClassifyInput): Promise<Classification> }`
  - `class ClassificationError extends Error`
  - `buildPrompt(input: ClassifyInput): { system: string; user: string }`
  - `claudeClassifier(opts: { client: Pick<Anthropic, "messages">; model?: string }): Classifier`

- [ ] **Step 1: Write the failing tests**

`prompt.test.ts`:
- `system lists every team name and description`.
- `user includes each neighbour's text, team and reasoning, then the request last`.
- `says there are no past decisions when neighbours is empty`: the user text contains `no past decisions`.

`classifier.test.ts` uses a stub `client.messages.parse` that records its params and returns a configurable result:
- `asks for the team as an enum of the given team names`: the params have `model: "claude-haiku-5-5"`, and the output format's JSON schema `team` enum equals `["Support","Sales"]`.
- `returns team, reasoning and token usage`.
- `throws ClassificationError on refusal`: `stop_reason: "refusal"`.
- `throws ClassificationError on max_tokens`.
- `throws ClassificationError when parsed_output is null`.
- `throws ClassificationError when the team is not one of the given teams`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @ac-1/triage`
Expected: FAIL on missing modules.

- [ ] **Step 3: Implement `prompt.ts`, then hand the guidance paragraph to the owner**

`buildPrompt` structure:
- **system**: the role, then each team as `## <name>\n<description>`, then a guidance paragraph.
- **user**: a "Past decisions made by a human reviewer" section, with each neighbour's similarity (2 decimals), team, reasoning and text. Then `New request:` followed by the text.

**Learning-mode hand-off:** leave the guidance paragraph as a `TODO(owner)` constant `ROUTING_GUIDANCE`, and ask the owner to write it. It says how to weigh past decisions against team descriptions, and what to do when they disagree. Use a placeholder sentence until then, so tests pass.

- [ ] **Step 4: Implement `classifier.ts`**

Call `client.messages.parse({ model, max_tokens: 8000, system, messages: [{ role: "user", content: user }], output_config: { format: zodOutputFormat(z.object({ team: z.enum(names), reasoning: z.string() })) } })` with `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Check `stop_reason` before reading `parsed_output`, and re-check that the team is in the list. Leave thinking and effort at the Haiku 5.5 defaults (adaptive, `medium`).

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -w @ac-1/triage && npm run typecheck -w @ac-1/triage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/triage
git commit -m "feat(triage): Claude Haiku classifier with team-constrained output"
```

---

### Task 5: The `triage()` flow

**Files:**
- Create: `packages/triage/src/triage.ts`
- Test: `packages/triage/src/triage.db.test.ts`

**Interfaces:**
- Consumes: `Embedder`, `Classifier`, `ClassificationError`, `setEmbedding`, `findNeighbours`, `MAX_SUBMISSION_LENGTH`.
- Produces:
  - `NEIGHBOUR_COUNT = 5`
  - `class SubmissionRejectedError extends Error`
  - `type TriageResult = { submissionId: string; team: string; reasoning: string; neighbours: Neighbour[] }`
  - `triage(db: PrismaClient, deps: { embedder: Embedder; classifier: Classifier }, input: { text: string; email: string }): Promise<TriageResult>`
  - `class TriageFailedError extends Error { submissionId: string }`. It wraps a classifier failure after the submission was saved.

Order: validate, then embed, then a transaction that upserts the user by exact email, creates the submission and sets its embedding, then `findNeighbours` (excluding itself), then load the teams, then classify, then create the `SuggestedTeam` (`hitlVerified: false`, team id looked up by name).

- [ ] **Step 1: Write the failing tests**

Tests use fake embedders (a fixed `unit(0)`, or one that throws) and fake classifiers (they record the input and return a fixed team, or throw `ClassificationError`). They run against the test DB with two seeded teams and one verified neighbour.
- `saves submission, embedding and an unverified suggestion`: the result's team matches the fake's. The DB has a `SuggestedTeam` with `hitlVerified:false`, and the submission's `embeddingModel` is the fake's model.
- `passes DB teams and the verified neighbour to the classifier`.
- `reuses an existing user by email`: two calls with the same email leave 1 user and 2 submissions.
- `rejects text over 5000 characters without calling the embedder`: `SubmissionRejectedError`, the embedder is not called, and 0 submissions exist.
- `accepts 5000 emoji` (`"😀".repeat(5000)`) and saves it.
- `rejects empty and whitespace-only text without calling the embedder`.
- `saves nothing when the embedder fails`: 0 users and 0 submissions.
- `keeps the submission but no suggestion when the classifier fails`: a `TriageFailedError` carrying the `submissionId`, 1 submission, and 0 suggestions.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -w @ac-1/triage`
Expected: FAIL on the missing module.

- [ ] **Step 3: Implement `triage.ts`**

The length check uses `[...text].length > MAX_SUBMISSION_LENGTH`. The emptiness check uses `text.trim() === ""`. The submission stores `text` exactly as given.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:db -w @ac-1/triage && npm test -w @ac-1/triage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/triage
git commit -m "feat(triage): triage flow from request to suggested team"
```

---

### Task 6: Backfill embeddings and the owner's labels

**Files:**
- Create: `packages/triage/src/backfill.ts`, `packages/triage/src/cli/backfill.ts`
- Test: `packages/triage/src/backfill.db.test.ts`
- Create (git-ignored, not committed): `.superpowers/triage-labels.json`

**Interfaces:**
- Consumes: `Embedder`, `submissionsNeedingEmbedding`, `setEmbedding`.
- Produces:
  - `type Label = { submissionId: string; team: string; reasoning: string }`
  - `backfillEmbeddings(db, embedder): Promise<{ embedded: number; skipped: number }>`. It makes one `embed` call for all pending rows.
  - `applyLabels(db, labels: Label[]): Promise<{ created: number; skipped: number }>`. It creates a `hitlVerified: true` suggestion per label, skips submissions that already have one, and throws before writing anything if a label names an unknown submission or team.
  - CLI: `npm run backfill -w @ac-1/triage -- [--labels <path>]`

- [ ] **Step 1: Write the failing tests**

- `embeds rows without an embedding and skips current ones`: the second run reports `embedded: 0`.
- `re-embeds rows made by another model`.
- `creates verified suggestions from labels`.
- `does not overwrite an existing suggestion`: an existing unverified suggestion is unchanged, and the count is `skipped: 1`.
- `rejects an unknown team or submission and writes nothing`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -w @ac-1/triage`. Expected: FAIL on the missing module.

- [ ] **Step 3: Implement `backfill.ts` and the CLI**

The CLI calls `requireEnv(["DATABASE_URL","VOYAGE_API_KEY"])`, runs `backfillEmbeddings`, then runs `applyLabels` if `--labels` is given, and prints both counts. Add the package script `"backfill": "node dist/cli/backfill.js"`, plus root scripts that build first: `"triage:backfill": "turbo run build --filter=@ac-1/triage && npm run backfill -w @ac-1/triage --"`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:db -w @ac-1/triage`. Expected: PASS.

- [ ] **Step 5: Commit the code**

```bash
git add packages/triage package.json
git commit -m "feat(triage): backfill embeddings and verified labels"
```

- [ ] **Step 6: Write the labels file and STOP for the owner**

Build `.superpowers/triage-labels.json` from `.superpowers/triage-label-notes.md`. Map rows 1–15 by `createdAt` order to ids. The six ⚠️ rows use the owner's note as `reasoning`, and the other nine get a one-line reason. Show the owner a table of id, the first 60 characters of the text, the team and the reasoning. **Do not run the backfill until the owner confirms.**

- [ ] **Step 7: Run the backfill against the dev DB (after confirmation)**

Run: `npm run triage:backfill -- --labels ../../.superpowers/triage-labels.json` (the path is relative to `packages/triage`), then run it again.
Expected: the first run reports `embedded 15` and `created 15`. The second reports `embedded 0` and `created 0, skipped 15`.

---

### Task 7: The triage CLI and the eval

**Files:**
- Create: `packages/triage/src/eval.ts`, `packages/triage/src/cli/triage.ts`, `packages/triage/src/cli/eval.ts`
- Test: `packages/triage/src/eval.db.test.ts`
- Modify: root `package.json` scripts, `README.md`

**Interfaces:**
- Consumes: `triage`, `claudeClassifier`, `voyageEmbedder`, `getEmbedding`, `findNeighbours`, `NEIGHBOUR_COUNT`, `EMBEDDING_MODEL`.
- Produces:
  - `type EvalReport = { total: number; correct: number; misses: { submissionId: string; expected: string; got: string; reasoning: string }[]; failures: { submissionId: string; error: string }[]; usage: { inputTokens: number; outputTokens: number } }`
  - `evaluate(db, classifier, opts: { model: string }): Promise<EvalReport>`. Leave-one-out over verified submissions embedded with `model`, comparing the classifier's team against `correctedTeam ?? team`. **Read-only.**

- [ ] **Step 1: Write the failing tests**

- `scores each verified submission against its effective team`: 3 verified rows, one with a `correctedTeam`, and a fake classifier that returns a fixed team. The test checks `total`, `correct`, and `misses`.
- `never passes a submission as its own neighbour`: the fake records `neighbours`, and no neighbour's text equals that call's `request`.
- `writes nothing`: the row counts of every table and the `updatedAt` max are unchanged after a run.
- `records a classifier failure and continues`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -w @ac-1/triage`. Expected: FAIL on the missing module.

- [ ] **Step 3: Implement `eval.ts` and both CLIs**

- `cli/triage.ts`: `parseArgs` takes one positional `text` and a required `--email`. It runs `requireEnv(["DATABASE_URL","ANTHROPIC_API_KEY","VOYAGE_API_KEY"])` and prints the team, the reasoning, and the neighbours (team plus similarity). On `SubmissionRejectedError` it exits 1. On `TriageFailedError` it prints the submission id and exits 1.
- `cli/eval.ts`: it prints `score: X/N`, each miss, each failure, and the total tokens.
- Root scripts: `"triage": "turbo run build --filter=@ac-1/triage && npm run cli -w @ac-1/triage --"` and `"triage:eval"` in the same style. Package scripts: `cli` → `node dist/cli/triage.js`, and `eval` → `node dist/cli/eval.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:db -w @ac-1/triage`. Expected: PASS.

- [ ] **Step 5: Smoke-test against the real APIs (spends cents)**

Run: `npm run triage -- "We were billed for 12 seats but only have 10 users" --email smoke-test@example.com`
Expected: a team (probably Finance), the reasoning, and 5 neighbours. The DB gains 1 user, 1 submission and 1 unverified suggestion.

Run: `npm run triage:eval` and record the counts first.
Expected: `score: X/15`. The `FormSubmission`/`SuggestedTeam` counts afterwards equal those before. Report the score to the owner as the Haiku baseline.

- [ ] **Step 6: README, full verification, commit**

Update the README:
- the Data model row for `FormSubmission` (embedding, cap);
- a "Triage" section with the three commands and their costs;
- the env table (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`);
- tick the roadmap's "Build the triage agent" as a CLI;
- the Open question "What happens when the agent can't decide?" stays.

Run: `env -u ANTHROPIC_API_KEY -u VOYAGE_API_KEY sh -c 'npm run build && npm run typecheck && npm test' && npm run test:db -w @ac-1/db && npm run test:db -w @ac-1/triage`
Expected: all pass.

```bash
git add packages/triage package.json README.md
git commit -m "feat(triage): triage CLI and leave-one-out eval"
```
