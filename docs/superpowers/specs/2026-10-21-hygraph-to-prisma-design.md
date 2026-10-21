# Hygraph → Prisma migration: design

**Date:** 2026-10-21
**Status:** Draft, awaiting approval

## Why

Hygraph works and isn't the problem in itself. Two things are pushing the move:

1. **Plan limits.** We keep running into Hygraph's quotas.
2. **Local, self-contained stack.** A fresh clone should come up with `docker compose up`, with no external services. A Postgres container behind Prisma gives us that.

The two Hygraph UIs each get a replacement:

| Hygraph | Replacement |
|---|---|
| Schema editor | `schema.prisma` plus Prisma migrations, in the repo |
| Content editor | **Now:** Prisma Studio. **Later:** an admin UI built in this app (separate project) |

## Current state (verified 2026-10-21)

- **No application code talks to Hygraph yet.** Hygraph only shows up in `README.md`, `.env.example`, and `.env`. There are no call sites to rewrite.
- `.env` has `HYGRAPH_TOKEN` set but **`HYGRAPH_ENDPOINT` blank**. The endpoint, taken from the token's `aud` claim, is `https://api-eu-west-2.hygraph.com/v2/cmv5icsht117v06uz7o09ncan/master`.
- The README describes an `Example` model that **doesn't exist** in Hygraph. The real models are below.
- All content is in the **DRAFT** stage; nothing has been published. Reads have to use `stage: DRAFT`.

### Hygraph models and data

| Model | Fields (system fields left out) | Records |
|---|---|---|
| `Team` | `name: String`, `description: String`, back-relation `suggestedTeams` | 5: Support, Sales, Finance, Product, Agency/Channel |
| `Customer` | `firstName: String`, `lastName: String`, `email: [String!]!`, `formSubmissions: [FormSubmission]` | 1 (one email, no names) |
| `FormSubmission` | `submittedValue: String`, `customer: Customer`, `suggestedTeam: SuggestedTeam` | 15 (all have text and a customer; none has a suggested team) |
| `SuggestedTeam` | `reasoning: String`, `hitlVerified: Boolean`, `correctedReasoning: String`, `formSubmission: FormSubmission`, `team: Team`, `correctedTeam: Team` | 0 |

`SuggestedTeam` holds the triage agent's pick for a submission, and a human can then check it and correct it (`hitlVerified`, `correctedTeam`, `correctedReasoning`).

## Goals

1. A new workspace package, **`packages/db`** (`@ac-1/db`), owns the Prisma schema, migrations, seed, and a shared Prisma client export. The web app and the future triage agent both import from it.
2. **Postgres** is the database.
3. The four Hygraph models become Prisma models, with these changes decided in conversation:
   - **`Customer` is renamed `User`.** Hygraph reserved the name `User`; Prisma doesn't.
   - **`email` becomes a single, unique, required `String`** on `User`, not a list. A separate `Email` model was considered and deferred: nothing needs several addresses per user yet.
4. **`docker compose up`** from a fresh clone brings up Postgres and the web app, with migrations applied and seed data loaded, and no manual steps.
5. A **one-time import script** copies the current Hygraph content into Postgres.
6. Hygraph is removed from the developer path: the README, `.env.example`, and the env var tables describe Postgres/Prisma instead.

## Non-goals

- The admin UI (later project; Prisma Studio covers us until then).
- The triage agent, the "How can I help?" form, and the `SupportRequest` Zod schema. These stay on the README roadmap and build on `@ac-1/db` later.
- Carrying over Hygraph's draft/published stages, version history, scheduled operations, assets, or `createdBy`/`updatedBy`/`publishedBy`. Nothing uses them.
- Hosted or production database deployment.
- Deleting the Hygraph project itself. That's the owner's decision, after the import is verified.

## Anti-goals (would count as failure even if it "works")

- A fresh clone that needs manual steps (running migrations, seeding, creating a DB) before `docker compose up` gives a working app.
- Real user data (the customer's email, submission text) committed to the repo as seed data.
- Secrets (DB password beyond a local-dev default, Hygraph token) shipped to the browser bundle or committed.

## Target schema (intent)

Exact Prisma syntax is left to the builder; the shape and constraints below are decided.

**Team**
- `id`, `createdAt`, `updatedAt`
- `name`: required, unique
- `description`: required. The routing text the agent reads.
- Relations: suggestions where it is `team`; suggestions where it is `correctedTeam`. Two named relations.

**User** (was `Customer`)
- `id`, `createdAt`, `updatedAt`
- `email`: required, unique
- `firstName`, `lastName`: optional
- Relation: many `FormSubmission`

**FormSubmission**
- `id`, `createdAt`, `updatedAt`
- `submittedValue`: required text
- `user`: required. Every existing submission has one.
- `suggestedTeam`: optional, one-to-one

**SuggestedTeam**
- `id`, `createdAt`, `updatedAt`
- `formSubmission`: required, unique (one suggestion per submission)
- `team`: required
- `reasoning`: required text
- `hitlVerified`: Boolean, default `false`
- `correctedTeam`: optional
- `correctedReasoning`: optional text

**Decisions marked as Claude's call (owner to confirm while reading):**
- *IDs are `String` cuids, and imported rows keep their Hygraph IDs.* Hygraph IDs are already cuid-shaped, so references survive the import unchanged and stay traceable.
- *Imported rows keep their Hygraph `createdAt`.*
- *Fields that were nullable in Hygraph become required* where the data and the domain agree (`Team.name`, `Team.description`, `FormSubmission.submittedValue`, `FormSubmission.user`, `SuggestedTeam.team`, `SuggestedTeam.reasoning`).
- *Long text fields use Postgres `text`* (`@db.Text`).
- *Deleting a `FormSubmission` cascades to its `SuggestedTeam`.* Deleting a `Team` or `User` that still has dependents is blocked (restrict), not cascaded.

## Data: seed vs. import

These are two separate things on purpose.

- **Seed (committed, runs automatically on `docker compose up`):** the 5 teams with their current names, descriptions, **and Hygraph IDs**, copied from Hygraph into a checked-in seed file. Teams are configuration, not personal data, so committing them is fine.
- **The database is the source of truth for teams (Claude's call).** The seed is **create-only**: it inserts a team only if no row with that ID exists, and it never updates an existing row. That way a description edited in Prisma Studio survives every restart. Changing the seed file only affects fresh databases.
- **Import (one-time, run by hand):** a script in `packages/db` that reads every model from Hygraph (`stage: DRAFT`) and upserts it into the Postgres pointed at by `DATABASE_URL`. Because the seed uses the same Hygraph IDs, importing into an already-seeded database matches the existing teams instead of clashing with the unique `name`. It brings over the customer as a `User` and the 15 submissions. It is idempotent (upsert by Hygraph ID) and prints per-model counts at the end so they can be checked against Hygraph (5 / 1 / 15 / 0). It reads `HYGRAPH_ENDPOINT` and `HYGRAPH_TOKEN` from the environment only while it runs. After the import is verified, those vars leave `.env.example`, and the script can be deleted in a follow-up.
- The Hygraph-to-Prisma mapping (the `Customer`-to-`User` rename, `email[0]` to `email`, field renames) should be a pure function with unit tests, kept separate from the network and DB calls.
- If a `Customer` has zero emails or more than one, the import fails loudly rather than guessing. Today's single customer has exactly one.

## Docker

- `docker-compose.yml` at the repo root, with:
  - **postgres**: an official Postgres image with a pinned major version, a named volume for data, a healthcheck, and local-dev credentials taken from `.env` with defaults that work out of the box.
  - **migrate**: a one-off service that waits for postgres to be healthy, runs `prisma migrate deploy` and then the seed, and exits.
  - **web**: the `apps/web` app. It starts only after `migrate` has finished successfully, and gets `DATABASE_URL` pointing at the postgres service.
- **Claude's call:** the `web` container runs a production-style build (build, then serve). That keeps it predictable. Day-to-day hot-reload development stays `npm run dev` on the host, pointed at the compose Postgres (Postgres port exposed on localhost).
- The Dockerfile has to work with npm workspaces and Turborepo (for example `turbo prune` or an equivalent multi-stage build). That detail is left to the builder.

## Tooling and versions

- **Prisma 7.10.x, pinned.** npm's `latest` tag on `prisma` currently points at `8.0.0-rc.24`, a release candidate, while `@prisma/client` latest is `7.10.1`. Don't use a caret range that could pull the RC. Follow Prisma 7 conventions: `prisma.config.ts`, the `prisma-client` generator with an explicit `output`, and the `@prisma/adapter-pg` driver adapter.
- `packages/db` follows the existing package conventions (ESM, `tsc` build, Vitest). Turborepo has to generate the Prisma client before anything that type-checks or builds against it.
- Env: add `DATABASE_URL` (plus any Postgres credentials compose needs) to `.env.example` with working local defaults.

## Constraints

- **Docker isn't installed on the owner's Mac yet** (no `docker` CLI, Docker Desktop, or OrbStack found). **Owner decided:** the plan installs Docker (Docker Desktop, e.g. `brew install --cask docker`) as an early step, and the plan ends with a real `docker compose up` check. Starting Docker Desktop for the first time may need the owner to click through its prompts.
- **Owner decided:** the plan starts with `git init` (with a `.gitignore` that keeps `.env`, `node_modules`, `dist`, `coverage`, and `.turbo` out of git) and commits after each step. This design doc is the first commit.
- Node ≥ 24, npm workspaces, and Turborepo, as the repo already uses.
- `apps/web` is in SPA mode with no server runtime. Nothing in this migration needs the web app to query the DB. Opening a server-side path for the agent is the separate "Where does the agent run?" question in the README.

## Done means

1. `docker compose up` on a clean checkout (empty volume) brings up Postgres, applies migrations, seeds 5 teams, and serves the web app.
2. Prisma Studio, run against the compose DB, shows all four models and the seeded teams, and a team description edited there survives `docker compose down && docker compose up`.
3. The import script, run against a local DB, reports 5 teams, 1 user, 15 submissions, and 0 suggested teams, and running it a second time changes nothing.
4. `npm run build`, `npm run typecheck`, and `npm test` pass from the root.
5. README and `.env.example` describe Postgres/Prisma. The README's "Teams live in Hygraph" section and its model table are updated to the real four-model schema.

## Left to the builder

Exact Prisma syntax and naming of relation fields, the Dockerfile strategy, the Postgres image version, how the seed file stores team data, test layout inside `packages/db`, and the Turborepo task wiring.
