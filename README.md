# ac-1

A support request form with an AI triage agent behind it.

Users get one question: **"How can I help?"** They answer in their own words. They don't pick a category or fill in structured fields. An agent reads the request and routes it to the right internal team.

## How it works

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│  apps/web    │     │  Triage agent    │     │  Internal team │
│  textarea:   │ ──▶ │  classifies the  │ ──▶ │  Support,      │
│ "How can I   │     │  request against │     │  Sales, ...    │
│   help?"     │     │  Hygraph teams   │     │                │
└──────────────┘     └──────────────────┘     └────────────────┘
                              ▲
                              │ teams + descriptions + examples
                     ┌──────────────────┐
                     │     Hygraph      │
                     └──────────────────┘
```

1. A user submits free text through the form in `apps/web`.
2. The triage agent loads the list of teams from Hygraph, compares the request against each team's description, and picks a team.
3. The request goes to that team.

## Teams live in Hygraph

The agent doesn't hard-code its routing rules. It reads them from the Hygraph CMS, so non-engineers can add or change teams and adjust routing without a code change.

| Model     | Field         | Purpose                                                                 |
| --------- | ------------- | ----------------------------------------------------------------------- |
| `Team`    | `name`        | Display name of the team                                                |
| `Team`    | `description` | When a request belongs to this team. The agent routes based on this text |
| `Team`    | `examples`    | Related `Example` entries                                               |
| `Example` | `sampleText`  | A sample request that belongs to the linked team (few-shot example)    |

Current teams: **Support**, **Sales**, **Finance**, **Product**, **Agency/Channel**.

> **Write descriptions that separate teams.** The agent can only route as well as the descriptions tell teams apart. The risky cases are on the borders, such as "upgrade my plan" (Sales or Finance?) and "this feature is broken" (Support or Product?). Say clearly what belongs where.

## Repository layout

This is an npm workspaces monorepo, orchestrated with [Turborepo](https://turbo.build).

```
apps/
  web/            # User-facing form: TanStack Start (React 19 + Vite), SPA mode
packages/
  schema/         # Shared Zod schemas used across apps (@ac-1/schema)
```

## Getting started

**Requirements:** Node 24 or later (see `.nvmrc`) and npm.

```sh
nvm use
npm install
cp .env.example .env   # then fill in the values below
npm run dev
```

### Environment variables

| Variable           | Where to find it                                                           |
| ------------------ | -------------------------------------------------------------------------- |
| `HYGRAPH_ENDPOINT` | Hygraph → Project Settings → Endpoints → High Performance Content API      |
| `HYGRAPH_TOKEN`    | Hygraph → Project Settings → Permanent Auth Tokens                          |

Keep `HYGRAPH_TOKEN` server-side. Never ship it to the browser.

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
- [ ] Build the triage agent: fetch teams from Hygraph, classify the request, return a team
- [ ] Decide how a routed request reaches its team (email, Slack, ticketing system, etc.)
- [ ] Hosted deployment of `apps/web`

## Open questions

- **Where does the agent run?** `apps/web` is set up in SPA mode, so it has no server at runtime. The agent needs secrets (Hygraph token, LLM API key), so it has to run server-side. Options are turning off SPA mode and using TanStack Start server functions, or running the agent as a separate API.
- **What happens when the agent can't decide?** Options include a fallback team, a human review queue, or a confidence threshold.
- **What does the user see after submitting?** For example, whether they are told which team picked up their request.
