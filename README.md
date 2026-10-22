# ac-1

A support request form with an AI triage agent behind it.

Users get one question: **"How can I help?"** They answer in their own words. They don't pick a category or fill in structured fields. An agent reads the request and routes it to the right internal team.

## How it works

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│  apps/web    │     │  Triage agent    │     │  Internal team │
│  textarea:   │ ──▶ │  packages/triage │ ──▶ │  Support,      │
│ "How can I   │     │  Voyage + Claude │     │  Sales, ...    │
│   help?"     │     │                  │     │                │
└──────────────┘     └──────────────────┘     └────────────────┘
                              ▲
                              │ teams, guidance, similar past decisions
                     ┌──────────────────┐
                     │ Postgres+pgvector│
                     │    packages/db   │
                     └──────────────────┘
```

1. A user submits free text. For now that's the `npm run triage` CLI; the form in `apps/web` comes later.
2. The request is saved as a `FormSubmission` and embedded with Voyage AI (`voyage-4`, 1024 numbers).
3. pgvector finds the 5 most similar past requests that a human has verified, with the team each one went to (the corrected team, if a human changed it).
4. Claude Haiku (`claude-haiku-5-5`) reads the team descriptions, the routing guidance, and those past decisions, and picks a team with its reasoning. The pick is saved as an unverified `SuggestedTeam`.
5. Verifying or correcting suggestions (in Prisma Studio for now) adds them to the examples later requests learn from.

## Data model

The schema lives in `packages/db/prisma/schema.prisma`. The agent doesn't hard-code its routing rules: it reads team descriptions and its routing guidance (the `routingGuidance` setting) from the database, so routing changes are data edits, not code changes. Until the admin UI exists, edit them in Prisma Studio (`npm run db:studio -w @ac-1/db`).

| Model            | Key fields                                                          | Purpose                                                          |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `Team`           | `name` (unique), `description`                                      | A team requests can go to. The agent routes based on `description` |
| `User`           | `email` (unique), `firstName`, `lastName`                           | The person who submitted a request                               |
| `FormSubmission` | `submittedValue` (max 5,000 characters), `user`, `embedding`, `embeddingModel` | One free-text request and its vector. Only vectors from the same model are compared |
| `SuggestedTeam`  | `formSubmission` (one per submission), `team`, `reasoning`, `hitlVerified`, `correctedTeam`, `correctedReasoning` | The agent's pick, plus a human's check or correction |
| `Setting`        | `key`, `value`                                                      | Text the app reads at runtime. `routingGuidance` tells the agent how to weigh past decisions against descriptions |

Current teams: **Support**, **Sales**, **Finance**, **Product**, **Agency/Channel**. They are seeded from `packages/db/src/seed-data.ts`, but only into a database with no teams at all, so teams edited or deleted in the database stay that way.

> **Write descriptions that separate teams.** The agent can only route as well as the descriptions tell teams apart. The risky cases are on the borders, such as "upgrade my plan" (Sales or Finance?) and "this feature is broken" (Support or Product?). Say clearly what belongs where.

## Repository layout

This is an npm workspaces monorepo, orchestrated with [Turborepo](https://turbo.build).

```
apps/
  web/            # User-facing form: TanStack Start (React 19 + Vite), SPA mode
packages/
  db/             # Prisma schema, migrations, seed, shared client (@ac-1/db)
  triage/         # Triage pipeline: Voyage embeddings, pgvector retrieval, Claude (@ac-1/triage)
  schema/         # Shared Zod schemas used across apps (@ac-1/schema)
```

## Getting started

**Requirements:** Docker (Docker Desktop or similar), Node 24 or later (see `.nvmrc`), and npm.

### Whole stack in Docker

```sh
cp .env.example .env   # the defaults work as-is
docker compose up --build
```

This starts Postgres, applies migrations, seeds the teams, and serves the app at http://localhost:3000.

### Hot-reload development

```sh
nvm use
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:deploy -w @ac-1/db && npm run db:seed -w @ac-1/db
npm run dev
```

### Environment variables

| Variable            | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`      | Postgres connection string used by the app and Prisma CLI  |
| `DATABASE_URL_TEST` | Separate database for `npm run test:db -w @ac-1/db`        |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Settings for the compose Postgres container |
| `ANTHROPIC_API_KEY` | Claude, which picks the team (triage scripts only)         |
| `VOYAGE_API_KEY`    | Voyage AI, which embeds requests (triage scripts only)     |

### Database scripts

Run with `-w @ac-1/db`:

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run db:migrate` | Create and apply a migration after editing the schema     |
| `npm run db:deploy`  | Apply existing migrations                                 |
| `npm run db:seed`    | Create teams (empty table only) and any missing settings  |
| `npm run db:studio`  | Open Prisma Studio to browse and edit data                |
| `npm run test:db`    | Run database tests against `DATABASE_URL_TEST`            |

### Triage scripts

Run from the repo root. They need `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` in `.env` and call paid APIs; `npm test` never does.

| Command | What it does | Cost |
| ------- | ------------ | ---- |
| `npm run triage -- "<request>" --email <email>` | Route one request and save it with its suggestion | ~1 Voyage + 1 Claude call |
| `npm run triage:eval` | Leave-one-out score over every verified submission. Writes nothing | 1 Claude call per verified row |
| `npm run triage:backfill -- [--labels <file>]` | Embed rows with no embedding (or one from an older model); with `--labels`, save human labels as verified suggestions | 1 Voyage call |

Database tests for the pipeline: `npm run test:db -w @ac-1/triage`.

## Scripts

Run these from the repo root. Turborepo runs each task across all workspaces.

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start every workspace in watch mode |
| `npm run build`     | Build all packages and apps         |
| `npm test`          | Run Vitest (with coverage)          |
| `npm run typecheck` | Type-check every workspace          |
| `npm run lint`      | Lint every workspace                |

## Roadmap

- [ ] Replace the placeholder home page in `apps/web` with the "How can I help?" form
- [ ] Define a `SupportRequest` schema in `packages/schema`
- [x] Build the triage agent (`@ac-1/triage`, CLI for now): retrieval over verified past decisions + Claude Haiku
- [ ] Run the triage agent server-side behind the form
- [ ] Decide how a routed request reaches its team (email, Slack, ticketing system, etc.)
- [ ] Hosted deployment of `apps/web`
- [ ] Admin UI for teams and triage review (replaces Prisma Studio)
- [x] Migrate from Hygraph to Prisma + Postgres

## Open questions

- **Where does the agent run?** `apps/web` is set up in SPA mode, so it has no server at runtime. The agent needs secrets (database URL, LLM API key), so it has to run server-side. Options are turning off SPA mode and using TanStack Start server functions, or running the agent as a separate API.
- **What happens when the agent can't decide?** Options include a fallback team, a human review queue, or a confidence threshold.
- **What does the user see after submitting?** For example, whether they are told which team picked up their request.
