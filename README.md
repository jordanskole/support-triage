# ac-1

A support request form with an AI triage agent behind it.

Users get one question: **"How can I help?"** They answer in their own words. They don't pick a category or fill in structured fields. An agent reads the request and routes it to the right internal team.

## How it works

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│  apps/web    │     │  Triage agent    │     │  Internal team │
│  textarea:   │ ──▶ │  classifies the  │ ──▶ │  Support,      │
│ "How can I   │     │  request against │     │  Sales, ...    │
│   help?"     │     │  the teams table │     │                │
└──────────────┘     └──────────────────┘     └────────────────┘
                              ▲
                              │ teams + descriptions
                     ┌──────────────────┐
                     │ Postgres (Prisma)│
                     │    packages/db   │
                     └──────────────────┘
```

1. A user submits free text through the form in `apps/web`.
2. The triage agent loads the list of teams from Postgres (via `@ac-1/db`), compares the request against each team's description, and picks a team.
3. The request goes to that team.

## Data model

The schema lives in `packages/db/prisma/schema.prisma`. The agent doesn't hard-code its routing rules: it reads team descriptions from the database, so routing changes are data edits, not code changes. Until the admin UI exists, edit them in Prisma Studio (`npm run db:studio -w @ac-1/db`).

| Model            | Key fields                                                          | Purpose                                                          |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `Team`           | `name` (unique), `description`                                      | A team requests can go to. The agent routes based on `description` |
| `User`           | `email` (unique), `firstName`, `lastName`                           | The person who submitted a request                               |
| `FormSubmission` | `submittedValue`, `user`                                            | One free-text request                                            |
| `SuggestedTeam`  | `formSubmission` (one per submission), `team`, `reasoning`, `hitlVerified`, `correctedTeam`, `correctedReasoning` | The agent's pick, plus a human's check or correction |

Current teams: **Support**, **Sales**, **Finance**, **Product**, **Agency/Channel**. They are seeded into fresh databases from `packages/db/src/seed-data.ts`. The seed only creates missing teams, so edits made in the database are never overwritten.

> **Write descriptions that separate teams.** The agent can only route as well as the descriptions tell teams apart. The risky cases are on the borders, such as "upgrade my plan" (Sales or Finance?) and "this feature is broken" (Support or Product?). Say clearly what belongs where.

## Repository layout

This is an npm workspaces monorepo, orchestrated with [Turborepo](https://turbo.build).

```
apps/
  web/            # User-facing form: TanStack Start (React 19 + Vite), SPA mode
packages/
  db/             # Prisma schema, migrations, seed, shared client (@ac-1/db)
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

### Database scripts

Run with `-w @ac-1/db`:

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run db:migrate` | Create and apply a migration after editing the schema     |
| `npm run db:deploy`  | Apply existing migrations                                 |
| `npm run db:seed`    | Create any missing teams                                  |
| `npm run db:studio`  | Open Prisma Studio to browse and edit data                |
| `npm run test:db`    | Run database tests against `DATABASE_URL_TEST`            |

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
- [ ] Build the triage agent: fetch teams from `@ac-1/db`, classify the request, return a team
- [ ] Decide how a routed request reaches its team (email, Slack, ticketing system, etc.)
- [ ] Hosted deployment of `apps/web`
- [ ] Admin UI for teams and triage review (replaces Prisma Studio)
- [ ] Delete the one-time Hygraph import (`packages/db/src/import-hygraph.ts`, `src/hygraph/`) and the Hygraph project

## Open questions

- **Where does the agent run?** `apps/web` is set up in SPA mode, so it has no server at runtime. The agent needs secrets (database URL, LLM API key), so it has to run server-side. Options are turning off SPA mode and using TanStack Start server functions, or running the agent as a separate API.
- **What happens when the agent can't decide?** Options include a fallback team, a human review queue, or a confidence threshold.
- **What does the user see after submitting?** For example, whether they are told which team picked up their request.
