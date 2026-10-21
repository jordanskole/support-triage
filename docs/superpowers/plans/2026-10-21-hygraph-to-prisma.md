# Hygraph → Prisma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Hygraph with Prisma + Postgres in a new `@ac-1/db` package, so `docker compose up` on a fresh clone brings up a migrated, seeded database and the web app.

**Architecture:** `packages/db` owns `schema.prisma`, migrations, a create-only team seed, a one-time Hygraph import, and a `createDb()` client factory. The import is split into a pure mapper (unit-tested), a fetcher, and a DB writer (integration-tested). Compose runs `postgres` → one-shot `migrate` (migrate deploy + seed) → `web`.

**Tech Stack:** Prisma 7.10.x (`prisma-client` generator, `@prisma/adapter-pg`), Postgres 18, Docker Desktop + Compose, npm workspaces, Turborepo, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-hygraph-to-prisma-design.md`

## Global Constraints

- Pin `prisma`, `@prisma/client`, `@prisma/adapter-pg` to `~7.10.1`. Never `^` or `latest`: npm `latest` on `prisma` is `8.0.0-rc.24`.
- Node ≥ 24, npm workspaces, Turborepo. Follow `packages/schema` conventions: ESM (`"type": "module"`), `tsc` build to `dist`, `module`/`moduleResolution: nodenext`, Vitest with v8 coverage.
- Model names: `Team`, `User` (was Hygraph `Customer`), `FormSubmission`, `SuggestedTeam`.
- IDs: `String @id @default(cuid())`. Imported rows keep Hygraph `id` and `createdAt`.
- Long text: `@db.Text` for `Team.description`, `FormSubmission.submittedValue`, `SuggestedTeam.reasoning`, `SuggestedTeam.correctedReasoning`.
- Hygraph reads always use `stage: DRAFT`. Endpoint: `https://api-eu-west-2.hygraph.com/v2/cmv5icsht117v06uz7o09ncan/master`.
- No real user data (the customer's email, submission text) in any committed file, including test fixtures. Use invented values like `ada@example.com`.
- `.env` is never committed or printed.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Studio edit, then restart.** A team description edited in the DB must survive a re-seed. Pinned in Task 3 (`seedTeams does not overwrite an edited description`).
2. **Import into an already-seeded DB.** Teams must match by Hygraph ID, with no unique-`name` clash. Pinned in Task 5 (`applyImport into a seeded db matches teams by id`).
3. **Hygraph data that breaks the new required fields** (a customer with 0 or 2+ emails, two customers with the same email, a submission with no text or no customer) must fail loudly, naming the record id. Pinned in Task 4.
4. **`HYGRAPH_ENDPOINT` blank** (it is blank in today's `.env`) must give a clear error that names the variable, not a fetch crash. Pinned in Task 5 (`readHygraphConfig`).
5. **More than one page of Hygraph results.** The fetcher must page until it gets a short page, not silently stop at 100. Pinned in Task 5 (`fetchHygraphSnapshot pages`).

---

### Task 1: Git repo and Docker runtime

**Files:**
- Modify: `.gitignore` (add `packages/db/src/generated`)

- [ ] **Step 1:** `git init -b main` in the repo root. Check `git status --ignored` and confirm `.env`, `node_modules`, `dist`, `coverage`, and `.turbo` are ignored.
- [ ] **Step 2:** Append `packages/db/src/generated` to `.gitignore` (the Prisma client output, created in Task 2).
- [ ] **Step 3: Commit.** `git add -A && git commit -m "chore: initial import of ac-1 with Prisma migration spec and plan"`. Then run `git show --stat HEAD | grep -c '\.env$'` and expect `0`.
- [ ] **Step 4:** Install Docker Desktop: `brew install --cask docker`, then `open -a Docker`. First launch may need the owner to accept the license and grant privileges. If so, stop and ask them to click through.
- [ ] **Step 5: Verify.** Run `docker info --format '{{.ServerVersion}}' && docker compose version`. Expected: a server version and `Docker Compose version v2.x`.

---

### Task 2: `@ac-1/db` package, schema, first migration

**Files:**
- Create: `packages/db/package.json`, `tsconfig.json`, `vitest.config.ts`, `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/**` (generated), `src/client.ts`, `src/index.ts`, `src/test/db.ts`, `src/schema.db.test.ts`
- Create: `docker-compose.yml` (postgres service only, for now), `docker/postgres/init.sql`
- Modify: `.env.example`, `turbo.json`

**Interfaces:**
- Produces: `createDb(databaseUrl?: string): PrismaClient`, from `@ac-1/db`. Defaults to `process.env.DATABASE_URL` and throws `Error("DATABASE_URL is not set")` if neither is given.
- Produces: `export type { PrismaClient, Team, User, FormSubmission, SuggestedTeam } from "./generated/prisma/client.js"`, re-exported from `src/index.ts`.
- Produces (test helper): `testDb(): PrismaClient` in `src/test/db.ts`. It uses `DATABASE_URL_TEST`. Also `resetDb(db): Promise<void>`, which runs `TRUNCATE "SuggestedTeam","FormSubmission","User","Team" CASCADE`.
- Produces scripts in `packages/db/package.json`: `build` = `prisma generate && tsc`, `typecheck`, `test` (unit only: `vitest run --coverage --exclude 'src/**/*.db.test.ts'`), `test:db` (`prisma migrate deploy` against `DATABASE_URL_TEST`, then `vitest run 'src/**/*.db.test.ts'`), `db:migrate` = `prisma migrate dev`, `db:deploy` = `prisma migrate deploy`, `db:seed` = `prisma db seed`, `db:studio` = `prisma studio`.

- [ ] **Step 1: Compose Postgres.** `docker-compose.yml` gets a `postgres` service:
  - image `postgres:18-alpine`;
  - env `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, defaulting to `ac1`/`ac1`/`ac1` via `${VAR:-default}`;
  - port `${POSTGRES_PORT:-5432}:5432`;
  - named volume `pgdata` mounted at `/var/lib/postgresql` (Postgres 18's layout, not `/var/lib/postgresql/data`);
  - healthcheck `pg_isready -U $${POSTGRES_USER}`;
  - `./docker/postgres/init.sql` mounted into `/docker-entrypoint-initdb.d/`. The init script runs `CREATE DATABASE ac1_test;`.
- [ ] **Step 2: Env.** Add these to `.env.example`, and to the owner's `.env` without touching any other line:
  - `DATABASE_URL=postgresql://ac1:ac1@localhost:5432/ac1`
  - `DATABASE_URL_TEST=postgresql://ac1:ac1@localhost:5432/ac1_test`
  - `POSTGRES_USER=ac1`, `POSTGRES_PASSWORD=ac1`, `POSTGRES_DB=ac1`, `POSTGRES_PORT=5432`

  Leave the `HYGRAPH_*` lines for now.
- [ ] **Step 3: Package scaffold.**
  - `package.json`: mirror `packages/schema` (exports `./dist/index.js`), plus the scripts above. Pin the Prisma deps per Global Constraints.
  - `prisma.config.ts`: `defineConfig` with schema `prisma/schema.prisma`, migrations path `prisma/migrations`, seed `node dist/seed.js`, and datasource url from `DATABASE_URL`. Load `../../.env` with `process.loadEnvFile` only if the file exists; compose supplies env directly.
  - Generator: `provider = "prisma-client"`, `output = "../src/generated/prisma"`, `moduleFormat = "esm"`, `importFileExtension = "js"`, so the generated code compiles under `nodenext`.
- [ ] **Step 4: Write `schema.prisma`** exactly per the spec's "Target schema":
  - `Team.name @unique`.
  - `User.email @unique`.
  - `SuggestedTeam.formSubmissionId @unique` with `onDelete: Cascade`.
  - Two named relations from `SuggestedTeam` to `Team` (`"SuggestedTeam"` and `"CorrectedTeam"`), both `onDelete: Restrict`.
  - `FormSubmission.user` with `onDelete: Restrict`.
  - `hitlVerified Boolean @default(false)`.
  - `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` on every model.
- [ ] **Step 4b: Env loading for scripts and tests.**
  - `vitest.config.ts` loads `../../.env` the same way `prisma.config.ts` does, so `DATABASE_URL_TEST` is set.
  - `test:db` runs `prisma migrate deploy` with `DATABASE_URL` overridden to `DATABASE_URL_TEST`. For example, a tiny `scripts/with-test-db.mjs` sets the env and spawns its args. Don't rely on shell-specific syntax.
- [ ] **Step 5:** `docker compose up -d postgres`, then `npm run db:migrate -w @ac-1/db -- --name init`. Expected: `prisma/migrations/<ts>_init/migration.sql` is created and the client is generated.
- [ ] **Step 6: Write failing tests** in `src/schema.db.test.ts`, using `testDb()`/`resetDb()`:
  - `rejects a second team with the same name`: the second `team.create({ name: "Support", ... })` rejects with Prisma code `P2002`.
  - `rejects a second user with the same email`: `P2002`.
  - `deleting a form submission deletes its suggested team`: afterwards `suggestedTeam.count()` is `0`.
  - `deleting a team referenced by a suggestion is blocked`: rejects with `P2003`.
  - `hitlVerified defaults to false`.
- [ ] **Step 7:** Run `npm run test:db -w @ac-1/db`. It should fail because `createDb` and the helpers don't exist yet.
- [ ] **Step 8: Implement `createDb`** in `src/client.ts` using `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. Then implement `src/test/db.ts` and `src/index.ts`.
- [ ] **Step 9:** Run `npm run test:db -w @ac-1/db` again. Expected: all 5 pass.
- [ ] **Step 10: Turbo.** Add `"src/generated/**"` to `build.outputs`. Add `"env": ["DATABASE_URL"]` where tasks read it. Then confirm `npm run build && npm run typecheck && npm test` from the root passes.
- [ ] **Step 11: Commit.** `feat(db): add @ac-1/db package with Prisma schema and Postgres compose service`

---

### Task 3: Create-only team seed

**Files:**
- Create: `packages/db/src/seed-data.ts`, `packages/db/src/seed.ts`, `packages/db/src/seed.db.test.ts`

**Interfaces:**
- Consumes: `createDb`, `testDb`, `resetDb` (Task 2).
- Produces: `TEAMS: readonly { id: string; name: string; description: string; createdAt: string }[]` and `seedTeams(db: PrismaClient): Promise<{ created: number; skipped: number }>`. `seed.ts` also runs `seedTeams(createDb())` as the module's entry point when executed directly. It logs the counts and disconnects.

- [ ] **Step 1: `seed-data.ts`.** Holds exactly these 5 teams, copied verbatim from Hygraph, typos included. The owner edits copy in Studio, not here.

| id | name | description | createdAt |
|---|---|---|---|
| `cmvfdpan4taih06lar04bdylr` | Support | For existing customers who need help: troubleshooting, bugs, account access, or how-to questions about the product. | 2026-10-19T14:57:50.340Z |
| `cmvfdpjmjsqyc06l8sb5mewss` | Sales | For prospects and customers interested in buying: pricing, demos, plan upgrades, quotes, and new contracts. | 2026-10-19T14:58:01.998Z |
| `cmvfdprvjsr8f06l8vb5djowo` | Finance | For billing and payment matters: invoices, refunds, failed payments, tax documents, and vendor or procurement paperwork. | 2026-10-19T14:58:12.688Z |
| `cmvfdq3e5srda06l8q7yo7d4o` | Product | For feedback about the product itself: feature requests, roadmap questions, and suggestions for improving existing functionality. | 2026-10-19T14:58:27.614Z |
| `cmvfdqy1gtboh06lapyi34mo9` | Agency/Channel | For when its a reseller | 2026-10-19T14:59:07.332Z |

- [ ] **Step 2: Write failing tests** in `seed.db.test.ts`:
  - `seedTeams creates all teams in an empty db`: returns `{ created: 5, skipped: 0 }`, and the DB has 5 teams whose ids match `TEAMS`.
  - `seedTeams is a no-op on second run`: the second call returns `{ created: 0, skipped: 5 }`.
  - `seedTeams does not overwrite an edited description`: seed, update Support's description to `"edited in studio"`, seed again, and the description is still `"edited in studio"`.
- [ ] **Step 3:** Run `npm run test:db -w @ac-1/db`. It should fail because `seedTeams` isn't defined.
- [ ] **Step 4: Implement `seedTeams`.** Use `createMany({ data: TEAMS, skipDuplicates: true })`. Its `count` is `created`, and `skipped = TEAMS.length - count`. Never use `upsert`/`update`: the DB is the source of truth.
- [ ] **Step 5:** Run `npm run test:db -w @ac-1/db`. Expected: all pass.
- [ ] **Step 6: Commit.** `feat(db): add create-only team seed`

---

### Task 4: Pure Hygraph → Prisma mapper

**Files:**
- Create: `packages/db/src/hygraph/types.ts`, `packages/db/src/hygraph/map.ts`, `packages/db/src/hygraph/map.test.ts`

**Interfaces:**
- Produces in `types.ts`: `HygraphSnapshot` with `teams`, `customers`, `formSubmissions`, and `suggestedTeams`, each array shaped like the Hygraph DRAFT fields in the spec. Relations are reduced to `{ id } | null`, and every record includes `createdAt: string`.
- Produces in `map.ts`:
  - `ImportPlan = { teams: Prisma.TeamCreateManyInput[]; users: Prisma.UserCreateManyInput[]; formSubmissions: Prisma.FormSubmissionCreateManyInput[]; suggestedTeams: Prisma.SuggestedTeamCreateManyInput[] }`
  - `class ImportError extends Error`
  - `mapSnapshot(snapshot: HygraphSnapshot): ImportPlan`

- [ ] **Step 1: Write failing tests** in `map.test.ts`, using an invented fixture (`ada@example.com`, `"my invoice is wrong"`):
  - `maps a customer to a user with a single email`: the user is `{ id, email: "ada@example.com", firstName: null, lastName: null, createdAt: Date }`.
  - `normalizes email by trimming and lowercasing` (a plan-time call not in the spec; it keeps the unique constraint meaningful): `" Ada@Example.com "` becomes `"ada@example.com"`.
  - `keeps hygraph ids and createdAt`.
  - `maps formSubmission.customer to userId`.
  - `maps suggestedTeam team/correctedTeam/formSubmission to ids and defaults hitlVerified null to false`.
  - `throws ImportError naming the customer id when email list is empty`.
  - `throws ImportError naming the customer id when email list has 2+ entries`.
  - `throws ImportError naming both ids when two customers share an email after normalizing`.
  - `throws ImportError naming the submission id when submittedValue is null or blank`.
  - `throws ImportError naming the submission id when customer is null`.
  - `throws ImportError naming the team id when name or description is null`.
  - `throws ImportError when a suggestedTeam has no team, no formSubmission, or null reasoning`.
- [ ] **Step 2:** Run `npx vitest run src/hygraph/map.test.ts` in `packages/db`. It should fail because `mapSnapshot` isn't defined.
- [ ] **Step 3: Implement `mapSnapshot`.** Validate everything first and collect every problem into one `ImportError` message, one line per record id, so a single run shows all the bad data. Map only once there are no problems.
- [ ] **Step 4:** Run the test again. Expected: all pass.
- [ ] **Step 5: Commit.** `feat(db): add pure Hygraph snapshot mapper with validation`

---

### Task 5: Hygraph fetch and import CLI

**Files:**
- Create: `packages/db/src/hygraph/fetch.ts`, `fetch.test.ts`, `apply.ts`, `apply.db.test.ts`, `packages/db/src/import-hygraph.ts`
- Modify: `packages/db/package.json` (add the script `"import:hygraph": "node dist/import-hygraph.js"`)

**Interfaces:**
- Consumes: `HygraphSnapshot`, `ImportPlan`, `mapSnapshot` (Task 4); `createDb`, `testDb`, `resetDb` (Task 2); `seedTeams` (Task 3).
- Produces:
  - `readHygraphConfig(env: NodeJS.ProcessEnv): { endpoint: string; token: string }`. Throws `Error` naming `HYGRAPH_ENDPOINT` or `HYGRAPH_TOKEN` when it's missing or blank.
  - `fetchHygraphSnapshot(config, fetchImpl: typeof fetch = fetch): Promise<HygraphSnapshot>`. Pages each model with `first: 100, skip: n`, `stage: DRAFT`, `orderBy: createdAt_ASC`, and throws on a GraphQL `errors` array.
  - `applyImport(db: PrismaClient, plan: ImportPlan): Promise<ImportCounts>`, where `ImportCounts = { teams: number; users: number; formSubmissions: number; suggestedTeams: number }` are the row counts in the DB after the import.

- [ ] **Step 1: Write failing unit tests** in `fetch.test.ts`, using a fake `fetchImpl`:
  - `readHygraphConfig throws naming HYGRAPH_ENDPOINT when blank`: env is `{ HYGRAPH_ENDPOINT: "", HYGRAPH_TOKEN: "x" }` and the message contains `HYGRAPH_ENDPOINT`.
  - `fetchHygraphSnapshot sends bearer token and stage DRAFT`.
  - `fetchHygraphSnapshot pages`: the fake returns 100 submissions, then 7. The result has 107, and the second request used `skip: 100`.
  - `fetchHygraphSnapshot throws on graphql errors`, and the message includes the first error's `message`.
- [ ] **Step 2: Write failing DB tests** in `apply.db.test.ts`:
  - `applyImport into an empty db returns counts`, for example `{ teams: 1, users: 1, formSubmissions: 2, suggestedTeams: 1 }` on a small fixture.
  - `applyImport is idempotent`: a second run gives the same counts and an unchanged `updatedAt` on a sample row.
  - `applyImport into a seeded db matches teams by id`: run `seedTeams`, then import a plan whose teams are `TEAMS` with the same ids. It doesn't throw, and there are still 5 teams.
- [ ] **Step 3:** Run `npm test -w @ac-1/db` and `npm run test:db -w @ac-1/db`. Both should fail on the missing functions.
- [ ] **Step 4: Implement `fetch.ts`.**
- [ ] **Step 5: Implement `applyImport`.** Use one `db.$transaction`, inserting in FK order: teams, users, form submissions, suggested teams. Use `createMany({ skipDuplicates: true })`, which keeps the import idempotent and leaves rows that already exist (seeded or Studio-edited) untouched. Then return `count()` for each model.
- [ ] **Step 6: Implement the `import-hygraph.ts` CLI:** `readHygraphConfig(process.env)`, then `fetchHygraphSnapshot`, `mapSnapshot`, `applyImport(createDb())`. Print `teams/users/formSubmissions/suggestedTeams` counts. On error, exit with code 1 and the message.
- [ ] **Step 7:** Run both test commands again. Expected: all pass.
- [ ] **Step 8: Real run (Done #3).**
  - Set `HYGRAPH_ENDPOINT` in the owner's `.env` to the endpoint in Global Constraints. It's blank today; change that one line only.
  - `npm run build -w @ac-1/db && npm run db:seed -w @ac-1/db && npm run import:hygraph -w @ac-1/db`
  - Expected output: `teams 5, users 1, formSubmissions 15, suggestedTeams 0`.
  - Run the import again. Expected: identical counts.
- [ ] **Step 9: Commit.** `feat(db): add one-time Hygraph import CLI`

---

### Task 6: Full stack in Docker Compose

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `@ac-1/db` scripts `db:deploy` and `db:seed` (Tasks 2–3); the `apps/web` `build`/`start` scripts.

- [ ] **Step 1: `.dockerignore`.** Exclude `node_modules`, `**/dist`, `**/coverage`, `.turbo`, `.env`, `.git`, and `packages/db/src/generated`.
- [ ] **Step 2: Multi-stage `Dockerfile`.**
  - Base `node:24-alpine`.
  - The builder stage copies the workspace, runs `npm ci` and `npx turbo run build`.
  - Target `migrate` runs `npm run db:deploy -w @ac-1/db && npm run db:seed -w @ac-1/db`.
  - Target `web` runs `npm run start -w @ac-1/web -- --host 0.0.0.0 --port 3000`.
  - `turbo prune` is optional, and `.env` must never get into the image.
- [ ] **Step 3: Compose services.**
  - `migrate`: `build.target: migrate`, with `DATABASE_URL=postgresql://${POSTGRES_USER:-ac1}:${POSTGRES_PASSWORD:-ac1}@postgres:5432/${POSTGRES_DB:-ac1}` and `depends_on: postgres: condition: service_healthy`.
  - `web`: `build.target: web`, port `3000:3000`, the same `DATABASE_URL`, and `depends_on: migrate: condition: service_completed_successfully`.
- [ ] **Step 4: Verify Done #1 on a clean volume.**
  - `docker compose down -v && docker compose up --build -d`
  - Wait for `docker compose ps`: `migrate` should show `exited (0)` and `web` should be running.
  - `docker compose logs migrate | grep -E 'created.*5'`
  - `curl -sf localhost:3000 | grep -q '<title>ac-1</title>'`
- [ ] **Step 5: Verify Done #2.**
  - Update Support's description directly: `docker compose exec postgres psql -U ac1 -c "UPDATE \"Team\" SET description='edited' WHERE name='Support'"`.
  - `docker compose down && docker compose up -d`, then wait for `migrate` to exit with 0.
  - The same query with `SELECT description` should return `edited`.
  - Restore the original description afterwards.
  - Ask the owner to open `npm run db:studio -w @ac-1/db` and confirm all four models appear.
- [ ] **Step 6: Commit.** `feat: run postgres, migrations, seed and web with docker compose`

---

### Task 7: Remove Hygraph from the developer path

**Files:**
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: README.**
  - Update the diagram and "How it works" to say Postgres/Prisma instead of Hygraph.
  - Replace "Teams live in Hygraph" with "Data model": a table of the four real models and their key fields from the spec. Keep the "Write descriptions that separate teams" callout, but say team descriptions are edited in Prisma Studio (`npm run db:studio -w @ac-1/db`) until the admin UI exists.
  - Add `packages/db` to the layout.
  - Getting started: `docker compose up` for the full stack; `docker compose up -d postgres && npm run dev` for hot reload.
  - Env table: `DATABASE_URL`, `DATABASE_URL_TEST`, `POSTGRES_*`.
  - Roadmap: the agent fetches teams from `@ac-1/db`; add "Admin UI (replaces Prisma Studio)" and "Delete Hygraph import script and Hygraph project".
  - Open questions: drop the Hygraph-token mention.
- [ ] **Step 2: `.env.example`.** Remove the `HYGRAPH_*` lines. `import-hygraph.ts`'s error message (Task 5) already says which vars to set if someone needs to run it again.
- [ ] **Step 3: Verify Done #4 and #5.**
  - `npm run build && npm run typecheck && npm test` from the root. Expected: all exit 0.
  - `npm run test:db -w @ac-1/db`. Expected: pass.
  - `grep -ri hygraph README.md .env.example` should show only the roadmap line about deleting the import script.
- [ ] **Step 4: Commit.** `docs: describe Postgres/Prisma setup and drop Hygraph from developer path`
