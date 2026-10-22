# Admin board: design

**Date:** 2026-10-21
**Status:** Approved by the owner, 2026-10-21

## Why

The triage agent picks a team for every request, but nothing happens after the pick: there's no way for a team to work the request, and the only way to teach the agent is a single human relabelling rows in Prisma Studio.

The owner's insight is that a single reviewer is the wrong loop. **Haiku's pick is an assignment, not a suggestion.** The submission lands with a team straight away. The team that receives it is the one best placed to say "this isn't ours", so it transfers it, with a reason, to the team it thinks is right, and that can repeat. A submission is settled when a team **answers** it. By the time a central reviewer would have got to it, the answer has already revealed which team was right.

That answer is the important artefact. ac-1 was a code-review interview task: "build the triage thing". The *problem* behind it is that a user shouldn't have to wait for an answer at all. Every answer a team writes becomes the evidence the agent learns from, which sets the agent up to eventually answer on its own and only route when it's unsure. This round builds the loop that collects those answers. The agent answering by itself is the destination, not this round.

## Decisions made with the owner

- **Its own app:** a new app in the monorepo, separate from `apps/web`.
- **Front end:** **React** and **Chakra UI v3**.
- **Layout: a board.** One column per team. Each card is an open submission held by that team.
- **Opening a card shows a Chakra `Drawer`** with:
  - the submission text;
  - the trail as a Chakra **`Timeline`**: the automatic pick and its reasoning first, then each transfer with its reason;
  - an answer box with a **Send answer** button;
  - a **Transfer** control.
- **Transfer by dragging** a card to another column. On drop, a box asks for the reason. Cancelling (Esc, or closing the box) puts the card back and saves nothing. The drawer's Transfer control does the same thing without dragging.
- **A transfer always needs a reason.** The reasons are part of what the agent learns from.
- **Generic wording for the agent.** The UI says "Auto-routed" (or similar), never "Haiku" or a model name.
- **Answering closes the submission.** The team that answers it is the correct team. There is no separate confirm or correct step.
- **The answer is saved, not sent.** Email delivery is assumed to exist later and is out of scope.
- **The board is the only screen this round.** Editing team names and descriptions and the routing guidance stays in Prisma Studio.
- **No people yet.** No logins, team members or "who did it". Anyone who opens the board can act for any team. People get added later.
- **The data model changes** (below): `hitlVerified`, `correctedTeam` and `correctedReasoning` are replaced by transfers and answers.
- **The 15 existing labelled submissions become backfilled answers** (below), so the agent keeps its history and the eval still has something to score.

## Current state (verified 2026-10-21)

- **Packages:** `apps/web` is a stub TanStack Start app in SPA mode, served with `vite preview` on port 3000. The other packages are `packages/db` (Prisma 7, Postgres 18 with pgvector), `packages/triage` (Voyage embeddings, Claude Haiku classifier, CLI, eval and backfill) and `packages/schema`.
- **Data model:** `SuggestedTeam` is one per submission. It holds `team`, `reasoning`, `hitlVerified`, and optional `correctedTeam` / `correctedReasoning`.
  - **Retrieval** (`findNeighbours` in `packages/db/src/embeddings.ts`) only uses rows with `hitlVerified = true`. It takes the team as `COALESCE(correctedTeam, team)` and the reasoning as `COALESCE(correctedReasoning, reasoning)`.
  - **The eval** (`packages/triage/src/eval.ts`) is leave-one-out over verified rows against `correctedTeam ?? team`. It scores 14/15 today.
- **Dev database:**
  - 5 teams, 2 users and 16 submissions.
  - The 16 submissions are 15 verified suggestions from the owner's labels, plus 1 unverified smoke-test submission (`smoke-test@example.com`). None of the verified ones has a correction.
  - Only the human reasoning for the 15 labels exists in the database, as `SuggestedTeam.reasoning`, because `applyLabels` wrote the labels file's reasoning there. The labels file (`.superpowers/triage-labels.json`) is git-ignored.
- **Triage behaviour:** `triage()` creates a `SuggestedTeam` with `hitlVerified: false`. If the classifier fails after the submission is saved, the submission has **no** suggestion (`TriageFailedError`).
- **Docker:** `docker compose up` runs postgres, then a one-shot `migrate` container (deploy and seed), then `web`. The Dockerfile has one build stage with a target per service.

## Goals

### 1. Data model

- **Keep `SuggestedTeam` as the automatic pick:** `team` and `reasoning`, one per submission. This is the first entry in every trail.
- **Remove `hitlVerified`, `correctedTeam` and `correctedReasoning`** from `SuggestedTeam`.
- **New `Transfer` model:** submission, from team, to team, reason (required, non-empty), and created time. A submission has zero or more transfers, in time order.
- **Answers:** a submission has at most one answer. It records the text (required, non-empty), the team that answered, the time, and a `backfilled` flag. Whether this is its own model or fields on `FormSubmission` is the builder's call.
- **The holder is the team that has the submission now.** That's the to-team of its latest transfer, or the suggestion's team if there are no transfers. Storing the holder on the submission (denormalised) is allowed and probably wise, because the board and the concurrency check both need it fast. If the builder does store it, it must never disagree with the transfer history.
- **States follow from the data.**
  - **Open:** no answer yet. Open submissions are on the board.
  - **Answered:** has an answer. Answered submissions are off the board, and they are what the agent learns from.
  - **Unrouted:** no suggestion, because triage failed after saving. These must still be visible (see the board) so they aren't lost.
- **One migration covers all of this, and it must preserve today's data:**
  - Every `SuggestedTeam` with `hitlVerified = true` becomes an answered submission with `backfilled = true`. The answering team is `COALESCE(correctedTeamId, teamId)`, and the answer text is `COALESCE(correctedReasoning, reasoning)`. Today that's the owner's 15 labels.
  - Every unverified suggestion stays as an open submission held by its suggested team. Today that's the 1 smoke-test row.
  - This can be plain SQL inside the migration, because the human text is already in the database. No script that reads the git-ignored labels file is needed. *(This corrects what was said in conversation, where we expected a one-off script. The data turned out to already be in place.)*
- **`backfilled` answers** are real labels for learning and eval, but the UI should show them as backfilled, for example with a badge, so nobody mistakes one for a reply that was sent to a customer.
- **The 15 backfilled submissions keep their `SuggestedTeam` rows,** so every submission that has been routed still has a suggestion and the holder rule stays simple. *(My call.)*
  - Those rows were written from the owner's labels, not by the agent. The drawer must not present them as an automatic pick.
  - For a backfilled submission, the timeline shows only the backfilled answer. Showing "Auto-routed → X" with the owner's own text would credit a human decision to the agent and repeat the text.

### 2. Agent learning (changes to `packages/db` and `packages/triage`)

- **Retrieval learns only from answered submissions.** A neighbour's team is the answering team.
- **What the agent sees for each past case:**
  - the request;
  - the team that answered it;
  - the answer text;
  - the transfer trail with its reasons, if there was one, so the agent sees where the lines between teams fell.

  The exact prompt layout is the builder's call. It replaces today's "Why: <reasoning>" line.
- **Backfilled text is presented as what it is.** *(My call.)*
  - A real answer is a reply to the customer. A backfilled one is the reviewer's routing note ("this is Finance because…").
  - The neighbour data carries the `backfilled` flag, and the prompt labels the two differently, for example "Answer sent to the customer" and "Reviewer's routing note".
  - That keeps the prompt honest as real answers start to outnumber the backfilled ones.
- **The eval becomes leave-one-out over answered submissions,** scored against the answering team. It stays read-only, and it must not show the held-out submission its own answer or trail.
- **`triage()` keeps its contract:** it saves the submission and creates the suggestion. The suggestion is now simply the assignment. Nothing else is created, because a submission with no transfers is held by its suggested team.
- **`applyLabels` / the `triage:backfill --labels` path** writes answered, backfilled submissions instead of verified suggestions, or is removed if the migration makes it pointless. Builder's call; the README must match.
- **Baseline:** after the change, `npm run triage:eval` on the migrated dev database should still score in the neighbourhood of 14/15, give or take one.
  - Today, all 15 neighbours are backfilled. They are the same rows with the same human text, and only the label changes.
  - A larger drop means the migration or retrieval is wrong. Find the cause before rewording the prompt to win the points back.

### 3. The admin app

- **Location:** `apps/admin`, an npm workspace like the others, wired into Turborepo (build, typecheck, test).
- **Stack (my call):** TanStack Start with **server functions** (or server routes), so the browser never connects to Postgres. Server code uses `@ac-1/db`. This matches `apps/web`'s framework, but admin can't be SPA-only, because it needs a server.
- **Drag and drop (my call; the owner confirmed it after checking their previous library was dnd-kit):** **`@atlaskit/pragmatic-drag-and-drop`**. It's maintained (4.0.0, Sept 2026), framework-agnostic and small.
  - `@dnd-kit/core` hasn't been published since Dec 2024, and its successor `@dnd-kit/react` is still 0.x.
  - Pragmatic DnD doesn't do keyboard dragging, but the drawer's Transfer control is the keyboard path, so nothing is lost.
  - The owner has used a DnD library before and may prefer it. If they name it, use that instead.
- **The board:**
  - One column per team, ordered by name. Each column header shows its open count.
  - Cards show:
    - the first line or so of the request;
    - where it came from, either "Auto-routed" or "↪ from \<team\>" for the latest transfer;
    - its age.
  - Cards within a column are ordered oldest first (my call: the longest wait sits at the top).
  - An extra **Unrouted** column, shown only when it's non-empty, holds submissions with no suggestion. From there they can be dragged to a team. Dragging out of Unrouted creates the first assignment. Whether that's a transfer with a null from-team or a hand-made suggestion is the builder's call; either way a reason is still required.
- **An Answered view** lets you look back over answered submissions: a toggle or filter, a simple list is fine, read-only. The drawer works the same there, but without the answer and transfer controls.
- **The drawer** follows the decisions above. The timeline shows:
  - the automatic pick (labelled generically) with its reasoning;
  - each transfer, as from → to with its reason and time;
  - for an answered submission, the answer last, with a backfilled badge if it has one.
- **Rules the server enforces,** not just the UI:
  - A transfer needs a non-empty reason and a to-team that is different from the current holder.
  - An answer needs non-empty text.
  - An answered submission can't be transferred or answered again.
  - Length caps on reason and answer: use 5,000 characters to match `submittedValue`, as one shared constant.
- **Concurrency:** every transfer or answer says which team the client believes holds the submission. The server applies it only if that's still true, atomically, so two people dragging the same card can't both succeed. On a conflict the client shows a short "This request moved" message and refreshes the board.
- **Freshness:** the board refetches after each action, and polls every few seconds (my call: about 5) so new triage results and other people's moves show up. No websockets.
- **Docker:**
  - `docker compose up` also starts admin as its own service after `migrate`, on its own port. My call is **3001**, since web uses 3000.
  - The Dockerfile gains an `admin` target.
  - `apps/admin/package.json` must be added to the Dockerfile's `COPY` list, as `packages/triage` was.

### 4. Docs

- **README:** update it for the admin app.
  - What it is, how to run it, and its port.
  - The new data model rows, with the `SuggestedTeam` row updated and rows for transfers and answers.
  - "How it works" should say retrieval learns from answered submissions.
  - The roadmap should tick the board and keep team/guidance editing, people, email and the answering agent as next steps.

## Non-goals

- **Editing teams, descriptions or the routing guidance in the UI.** That stays in Prisma Studio for now.
- **People:** logins, team membership, "who did it" on transfers and answers, and any permission checks.
- **Sending email,** or any delivery of the answer.
- **The agent drafting or sending answers.**
- **Submitting requests from the UI.** New submissions still come from `npm run triage`, and the board picks them up on its next poll.
- **Real-time sync, notifications, SLAs, and search or filter on the board.**

## Anti-goals

- **Losing a submission.** Every submission is reachable on the board (open or unrouted) or in the Answered view.
- **A transfer without a reason, or a transfer that "half happens"** (for example, the holder changes but no transfer row is written).
- **Training data that quietly gets worse.** Unanswered submissions must never feed retrieval or the eval, and the migration must not drop or change the 15 labels.
- **Model or vendor names in the UI.**
- **Tests that call paid APIs.** The `npm test` rule from the triage round still holds.

## Constraints

These carry over from earlier rounds.
- **Tooling:** Node 24+, npm 12 (install scripts blocked), TypeScript 7, Vitest, ESM, Prisma 7.10.x, Postgres with pgvector, Turborepo.
- **Secrets and data:** keep `.env` secrets and the real customer data out of git and out of output.
- **Database changes:** schema changes are Prisma migrations, written by hand if `migrate dev` won't run non-interactively, and checked for no drift. The dev database must survive the migration.
- **Tests:**
  - New server logic (transfer, answer, holder, conflicts, retrieval over answers, the migration's mapping) gets DB tests against `ac1_test`, in the existing style.
  - UI tests are the builder's call. The rules that matter are enforced and tested on the server.

## Left to the builder

- The exact Prisma shapes: the `Answer` model or answer fields on the submission, whether to store the holder, and how unrouted assignment is recorded.
- Where the transfer and answer logic lives. Putting it in `@ac-1/db` or a small package keeps it testable outside the app.
- How server functions are organised, Chakra theming, and card and drawer details within the decisions above.
- The prompt layout for answered neighbours.
- UI testing approach.
