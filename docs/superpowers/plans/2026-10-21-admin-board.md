# Admin Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-reviewer verification with a team board. The automatic pick assigns a submission to a team, teams transfer it with a reason or answer it, and the agent learns from answered submissions.

**Architecture:**
- **Data model:**
  - `FormSubmission` gains a denormalised holder (`holderTeamId`) and answer fields (`answer`, `answeredAt`, `answerBackfilled`).
  - A new `Transfer` table records every move.
  - `SuggestedTeam` shrinks to the automatic pick.
- **Board logic** (read, transfer, answer) lives in `@ac-1/db/src/board.ts`, so it is DB-tested outside the UI. Transfers and answers are compare-and-set updates on the submission row, so concurrent moves can't both win.
- **`apps/admin`** is a TanStack Start app with Chakra UI v3. Its server functions call `@ac-1/db`, and the client uses TanStack Query (5 s polling) and pragmatic drag-and-drop.

**Tech Stack:** Prisma 7.10 + Postgres 18/pgvector, TanStack Start 1.169 + React 19, Chakra UI 3.37 (+ `@emotion/react` 11), `@tanstack/react-query` 5, `@atlaskit/pragmatic-drag-and-drop` 4, `zod` 4, Vitest 5, `pg` 8 (test-only, migration test).

**Spec:** `docs/superpowers/specs/2026-10-21-admin-board-design.md`

## Global Constraints

**Toolchain and packages**
- Node 24+, npm 12 (install scripts blocked), TypeScript 7, ESM, Vitest 5, Turborepo.
- Prisma pinned `~7.10.x`, with the generator output at `src/generated/prisma`.
- New dependencies: pin `~` for anything that touches Prisma; use `^` otherwise, matching the repo.

**Data**
- Schema changes are Prisma migrations, written by hand if `migrate dev` won't run non-interactively. Prove there's no drift with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (an empty script).
- **The dev DB must survive.** `pg_dump` it before applying the migration, and compare counts before and after.
- Reason and answer text are capped at **5,000 characters**, counted in code points (`[...s].length`). The cap is one shared constant next to `MAX_SUBMISSION_LENGTH`. Trim before checking for empty text.
- **Secrets and customer data:** keep `.env` values and real customer data (submission text, the labels file, `.superpowers/`) out of git and out of output.

**Copy and UI**
- UI copy says **"Auto-routed"**, never "Haiku", "Claude" or a model name.
- Backfilled answers carry a visible **"Backfilled"** badge.
- For a backfilled submission, the trail never shows the automatic pick.
- Prompt labels: **"Answer sent to the customer"** for real answers, **"Reviewer's routing note"** for backfilled ones.

**Tests and runtime**
- `npm test` never calls paid APIs. DB tests run against `DATABASE_URL_TEST` via `test:db`.
- Admin runs on port **3001**: in dev, in `vite preview`/production, and in compose. Web stays on 3000.
- The board polls every **5,000 ms** and refetches after every action.

## Review Focus

1. **Drop handling:** dropping a card on its own column, or pressing Esc or cancelling the reason dialog, must save nothing and leave the card where it was. The `canDrop` test in Task 4 and the dialog-cancel step in Task 6 cover this.
2. **Whitespace and emoji text:** a whitespace-only reason or answer is rejected server-side, and 5,000 emoji are accepted. Task 3 has tests for both.
3. **A stale drawer:** if the open card was moved or answered elsewhere, the action shows "This request moved" and the board refreshes, with no crash. Task 3 has the conflict tests, and Task 6 has the UI step.
4. **Holder drift:** `holderTeamId` must equal the last transfer's to-team, or the suggestion's team when there are no transfers. That has to hold after triage, every transfer, the migration and `applyLabels`. Task 3's `holderMatchesHistory` test asserts it, and Tasks 1 and 2 add it to their own tests.
5. **Retrieval leaks:** unanswered submissions never appear as neighbours, and the eval never shows a held-out row its own answer. Tests in Tasks 1 and 2 cover both.

---

### Task 1: Schema, migration, retrieval over answers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/embeddings.ts`, `packages/db/src/limits.ts`, `packages/db/src/index.ts`, `packages/db/src/test/db.ts`, `packages/triage/src/test/db.ts`, `packages/db/package.json` (devDep `pg ^8.23.1`, `@types/pg`)
- Create: `packages/db/prisma/migrations/20261022020000_board/migration.sql`
- Test: `packages/db/src/migration.db.test.ts` (new); `packages/db/src/embeddings.db.test.ts` and `packages/db/src/schema.db.test.ts` (update the fixtures that use removed fields)

**Interfaces:**
- **Produces, in the schema:**
  - `SuggestedTeam { id, createdAt, updatedAt, reasoning, formSubmissionId @unique, teamId }`. The fields `hitlVerified`, `correctedTeamId` and `correctedReasoning` are removed.
  - `FormSubmission` gains:
    - `holderTeamId String?` (relation `"Holder"` to Team, `onDelete: Restrict`);
    - `answer String? @db.VarChar(5000)`;
    - `answeredAt DateTime?`;
    - `answerBackfilled Boolean @default(false)`;
    - `transfers Transfer[]`.
  - `Transfer { id cuid, createdAt, formSubmissionId (Cascade), fromTeamId String? (relation "TransferFrom", Restrict), toTeamId (relation "TransferTo", Restrict), reason String @db.VarChar(5000) }`, with `@@index([formSubmissionId, createdAt])`.
  - `Team` gains the back-relations.
- **Produces in `limits.ts`:** `MAX_NOTE_LENGTH = 5000`, the cap for reasons and answers.
- **Produces in `embeddings.ts`:**
  ```ts
  export type NeighbourTransfer = { from: string | null; to: string; reason: string };
  export type Neighbour = {
    submissionId: string; text: string;
    team: string;          // the answering team (holder of an answered submission)
    answer: string; backfilled: boolean;
    transfers: NeighbourTransfer[]; // oldest first; [] if none
    similarity: number;
  };
  ```
  The signature of `findNeighbours(db, {vector, model, k, excludeSubmissionId?})` is unchanged, but it now returns only submissions with `answeredAt IS NOT NULL`.
- **Exports:** `index.ts` exports `MAX_NOTE_LENGTH`, `NeighbourTransfer` and the `Transfer` type.

- [ ] **Step 1: Back up the dev DB and record its counts.**
  - Run `pg_dump -Fc` inside the postgres container to `.superpowers/backups/ac1-pre-board-2026-10-21.dump`.
  - Record the counts of teams, users, submissions, verified suggestions and unverified suggestions.
  - Expected: `5|2|16|15|1`.

- [ ] **Step 2: Write the failing migration test `migration.db.test.ts`.**
  - **Setup:** connect with `pg.Client` to `DATABASE_URL_TEST`, using `options: "-c search_path=mig_test,public"`. Drop and create the schema `mig_test`.
  - **Before:** run every `prisma/migrations/*/migration.sql` *before* `20261022020000_board`, in folder order. Insert old-shape rows with raw SQL:
    - teams A and B and one user;
    - submission s1, verified on team A with reasoning "r1";
    - submission s2, verified on A but corrected to B with correctedReasoning "c2";
    - submission s3, unverified on A with reasoning "auto3";
    - submission s4, with no suggestion.
  - **Act:** run the board migration file.
  - **Assert:**
    ```ts
    // s1: holder A, answer "r1", answerBackfilled true, answeredAt not null
    // s2: holder B, answer "c2", backfilled true; its SuggestedTeam.teamId is now B (so holder == pick, no transfer needed)
    // s3: holder A, answer null, answeredAt null, backfilled false
    // s4: holder null, answer null
    // Transfer table exists and is empty; SuggestedTeam has no hitlVerified/correctedTeamId/correctedReasoning columns
    ```
  - **Teardown:** drop the schema `mig_test` in `afterAll`.

- [ ] **Step 3: Run `npm run test:db -w @ac-1/db -- migration`.**
  - Expected: FAIL. The migration file doesn't exist yet.

- [ ] **Step 4: Edit `schema.prisma` and write `migration.sql`.**
  - **Get the DDL** from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, run against a DB at the previous migration.
  - **Hand-insert the data steps** *before* the column drops:
    1. Set `SuggestedTeam.teamId = COALESCE("correctedTeamId", "teamId")` where `hitlVerified`.
    2. Set `FormSubmission.holderTeamId` from the suggestion's team.
    3. For verified rows, set `answer = COALESCE("correctedReasoning", reasoning)`, `answeredAt = st."updatedAt"` and `answerBackfilled = true`.
  - **Add two CHECK constraints:**
    - `("answer" IS NULL) = ("answeredAt" IS NULL)`
    - `"answer" IS NULL OR "holderTeamId" IS NOT NULL`
  - **Ruling to record:** rewriting `teamId` for corrected rows keeps the holder rule intact without inventing transfers. There are 0 such rows in the dev DB today.

- [ ] **Step 5: Run the migration test.**
  - Expected: PASS.

- [ ] **Step 6: Update `findNeighbours` and its tests for answered submissions.**
  - **Query:**
    - Filter on `fs."answeredAt" IS NOT NULL`.
    - Take `team` from the holder Team.
    - Take `answer` and `backfilled` from the submission.
    - Build `transfers` with a correlated `COALESCE(json_agg(json_build_object('from', ft.name, 'to', tt.name, 'reason', tr.reason) ORDER BY tr."createdAt"), '[]')`.
  - **Fixtures:** in `embeddings.db.test.ts`, replace `verified`, `correctedTeamId` and `correctedReasoning` with `answered?: boolean`, `backfilled?: boolean` and `transfers?: {fromTeamId, toTeamId, reason}[]`. The fixture sets the holder to the last transfer's to-team, or `teamId`.
  - **Test names:**
    - `returns answered neighbours nearest first`
    - `skips open submissions`, which replaces "skips unverified"
    - `uses the answering team and answer, with transfers oldest first`
    - `marks backfilled answers`
    - the existing model-filter and exclude tests, kept as they are
  - **Elsewhere:** update the `schema.db.test.ts` fixtures, and add `"Transfer"` to both `resetDb` TRUNCATE lists.

- [ ] **Step 7: Run `npm run test:db -w @ac-1/db`.**
  - Expected: all PASS, with the migration test included.

- [ ] **Step 8: Apply the migration to the dev DB and check the data survived.**
  - Run `npm run db:deploy -w @ac-1/db`, then the drift check.
  - Expected:
    - the drift check prints an empty script;
    - counts: submissions 16, answered 15 (all backfilled), open 1 (holder set), transfers 0.

- [ ] **Step 9: Commit.**
  - Message: `feat(db): transfers and answers replace verification`.
  - The triage package won't compile until Task 2. That's expected, and Task 2 starts immediately.

### Task 2: Triage learns from answers

**Files:**
- Modify: `packages/triage/src/triage.ts`, `prompt.ts`, `eval.ts`, `backfill.ts`, `cli/backfill.ts`, `cli/eval.ts` (wording only)
- Test: `prompt.test.ts`, `triage.db.test.ts`, `eval.db.test.ts`, `backfill.db.test.ts`

**Interfaces:**
- Consumes: Task 1's `Neighbour` and schema.
- Produces:
  - `triage()` keeps its signature. It creates the suggestion **and** sets `holderTeamId` in one transaction.
  - `applyLabels(db, labels)` keeps its signature. For each label, it creates a suggestion (team, reasoning) and sets holder = team, `answer = reasoning`, `answeredAt = now` and `answerBackfilled = true`. It skips submissions that already have a suggestion.
  - `evaluate(db, classifier, {model})` keeps its signature and `EvalReport`. It now covers answered submissions, scored against the holder team's name.

- [ ] **Step 1: Write the failing tests.**
  - **`prompt.test.ts`:** each neighbour fixture becomes `{..., team: "Finance", answer: "Refunded you.", backfilled: false, transfers: [{from: "Support", to: "Finance", reason: "money back"}]}`. Assert:
    - the user prompt contains `"Answer sent to the customer"` and `"Refunded you."`;
    - it contains `"Support → Finance"` and `"money back"`;
    - for a backfilled neighbour it contains `"Reviewer's routing note"` and **not** `"Answer sent to the customer"`.
  - **`triage.db.test.ts`:**
    - `"sets the holder to the suggested team"`: `formSubmission.holderTeamId === finance.id`, and `answer` is null.
    - Seed the neighbour as answered: holder finance, answer "duplicate charge", backfilled.
  - **`eval.db.test.ts`:**
    - Seed answered rows, one of them with a transfer Support → Finance and holder Finance. It is expected to score as "Finance".
    - `"ignores open submissions"`: an extra unanswered row doesn't change `total`.
    - `"never shows a held-out row its own answer"`: no call's neighbours contain the call's own `request`.
  - **`backfill.db.test.ts`:**
    - Labels produce answered, backfilled rows whose holder is the label's team.
    - Re-running skips them.
    - The unknown-team and unknown-submission errors are unchanged.

- [ ] **Step 2: Run `npm run test:db -w @ac-1/triage && npm test -w @ac-1/triage`.**
  - Expected: FAIL. You'll see type errors or assertion failures on the new fields.

- [ ] **Step 3: Implement the changes.**
  - **`prompt.ts`:**
    - Heading: `# Past requests a team answered`.
    - Each block: `### Request i (similarity x.xx)`, then `Answered by: <team>`, then a `Moved: <from ?? "Unrouted"> → <to>: <reason>` line per transfer, then `Answer sent to the customer:` or `Reviewer's routing note:`, the text, then `Request:` and the text.
    - The empty-neighbours sentence stays, with "no past requests" in place of "no past decisions". Update that test's wording too.

- [ ] **Step 4: Run the Step 2 commands again, then `npm run typecheck`.**
  - Expected: all PASS.

- [ ] **Step 5: Run the paid baseline eval.**
  - Run `npm run triage:eval`, then save the output to `.superpowers/triage-eval-board-2026-10-21.txt`.
  - Expected: 13 to 15 out of 15. A larger drop is a bug: debug retrieval or the migration, and don't touch the prompt wording.

- [ ] **Step 6: Commit.**
  - Message: `feat(triage): learn from answered submissions and their transfers`.

### Task 3: Board logic in `@ac-1/db`

**Files:**
- Create: `packages/db/src/board.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/board.db.test.ts`

**Interfaces:**
- Produces (all exported from `@ac-1/db`):
  ```ts
  export type CardOrigin =
    | { kind: "auto" } | { kind: "transfer"; fromTeam: string | null } | { kind: "unrouted" };
  export type BoardCard = { id: string; text: string; createdAt: Date; holderTeamId: string | null; origin: CardOrigin };
  export type Board = { teams: { id: string; name: string; cards: BoardCard[] }[]; unrouted: BoardCard[] };
  export type TrailEntry =
    | { kind: "auto"; team: string; reasoning: string; at: Date }
    | { kind: "transfer"; from: string | null; to: string; reason: string; at: Date }
    | { kind: "answer"; team: string; body: string; backfilled: boolean; at: Date };
  export type SubmissionDetail = {
    id: string; text: string; email: string; createdAt: Date;
    status: "open" | "answered" | "unrouted";
    holder: { id: string; name: string } | null;
    trail: TrailEntry[]; // oldest first
  };
  export type AnsweredItem = { id: string; text: string; team: string; answeredAt: Date; backfilled: boolean };
  export class BoardConflictError extends Error {}   // "This request moved"
  export class BoardValidationError extends Error {}
  export function getBoard(db: PrismaClient): Promise<Board>;
  export function getAnswered(db: PrismaClient): Promise<AnsweredItem[]>; // newest answered first
  export function getSubmissionDetail(db: PrismaClient, id: string): Promise<SubmissionDetail | null>;
  export function transferSubmission(db: PrismaClient, input: {
    submissionId: string; expectedHolderTeamId: string | null; toTeamId: string; reason: string;
  }): Promise<void>;
  export function answerSubmission(db: PrismaClient, input: {
    submissionId: string; expectedHolderTeamId: string; body: string;
  }): Promise<void>;
  ```
- **`getBoard` rules:**
  - It only includes open submissions (`answeredAt IS NULL`).
  - Every team gets a column, ordered by name, even when the column is empty.
  - Cards are ordered oldest first.
  - A card's `origin` comes from its latest transfer, otherwise `auto` if it has a suggestion, otherwise `unrouted`.
- **`getSubmissionDetail` rules:** the trail is the auto entry (left out when `answerBackfilled`), then the transfers, then the answer.
- **Transfer and answer are compare-and-set updates.**
  - Each runs in a `$transaction`, starting with `updateMany` on `FormSubmission`.
  - Transfer: `where {id, holderTeamId: expected, answeredAt: null}`. Answer: the same `where`, plus `holderTeamId` not null.
  - `count === 0` means a `BoardConflictError` if the submission exists. If it doesn't exist, that's a `BoardValidationError`.
  - The transfer then inserts its `Transfer` row with `fromTeamId: expected`, in the same transaction.
- **Validation, all of it before the write:**
  - Trim the text. Empty text, or more than `MAX_NOTE_LENGTH` code points, is a `BoardValidationError`.
  - An unknown `toTeamId` is a `BoardValidationError`.
  - Transferring to the current holder (`toTeamId === expectedHolderTeamId`) is a `BoardValidationError`.
  - Answering an unrouted submission isn't possible, because the type requires a string holder. Assign it first. Record that as a ruling.

- [ ] **Step 1: Write the failing `board.db.test.ts`.** It has these tests:
  - `getBoard lists every team, open cards oldest first, answered excluded`
  - `getBoard puts submissions with no suggestion in unrouted`
  - `card origin is auto, then "from <team>" after a transfer`
  - `transfer moves the holder and records from/to/reason`
  - `transfer from unrouted records a null from-team`
  - `rejects empty, whitespace-only and 5001-character reasons`
  - `accepts a 5000-emoji reason`
  - `rejects a transfer to the current holder`
  - `stale expected holder → BoardConflictError, nothing written`
  - `two concurrent transfers from the same holder: exactly one succeeds`, using `Promise.allSettled`, with one fulfilled and one rejected as a `BoardConflictError`
  - `answer sets answer/answeredAt, keeps holder, card leaves the board`
  - `answering or transferring an answered submission → BoardConflictError`
  - `concurrent answer and transfer: exactly one succeeds`
  - `detail trail: auto, transfers, answer in order; backfilled omits auto`
  - `getAnswered newest first with backfilled flag`
  - `holderMatchesHistory`: after a run of transfers, `holderTeamId` equals the last `toTeamId`

- [ ] **Step 2: Run `npm run test:db -w @ac-1/db -- board`.**
  - Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `board.ts` to the interfaces above.**

- [ ] **Step 4: Run `npm run test:db -w @ac-1/db`.**
  - Expected: all PASS.

- [ ] **Step 5: Commit.**
  - Message: `feat(db): board reads, transfers and answers`.

### Task 4: `apps/admin` scaffold, read-only board, Docker

**Files:**
- **Create, app files:**
  - `apps/admin/package.json` (`@ac-1/admin`)
  - `tsconfig.json`, `tsr.config.json`, `vite.config.ts` (`server.port: 3001`, `preview.port: 3001`), `vitest.config.ts`
  - `app/router.tsx`
  - `app/routes/__root.tsx`: `ChakraProvider value={defaultSystem}` and `QueryClientProvider`
  - `app/routes/index.tsx`: the board
  - `app/server/db.ts`: a lazy singleton, `createDb(process.env.DATABASE_URL)`
  - `app/server/board.ts`: server functions
  - `app/components/Board.tsx`, `app/components/BoardColumn.tsx`, `app/components/BoardCard.tsx`
  - `app/lib/format.ts`, with its test `app/lib/format.test.ts`
- **Modify:** `Dockerfile` (COPY `apps/admin/package.json`, plus a new `admin` target), `docker-compose.yml` (an `admin` service on 3001 that depends on `migrate`).

**Interfaces:**
- **Consumes:** Task 3's `getBoard`, `getAnswered`, `getSubmissionDetail` and their types.
- **Produces, server functions** (`createServerFn` from `@tanstack/react-start`, inputs validated with zod):
  - `getBoardFn()` returns `Board`
  - `getAnsweredFn()` returns `AnsweredItem[]`
  - `getSubmissionFn({ id })` returns `SubmissionDetail | null`

  Dates cross the wire as ISO strings or `Date`, whichever Start's serializer gives you. Pick one, and convert in `format.ts` if needed.
- **Produces, in `format.ts`:**
  - `originLabel(o: CardOrigin): string`: `"Auto-routed"`, `"↪ from <team>"`, `"↪ from Unrouted"` or `"Unrouted"`.
  - `age(from: Date, now: Date): string`: `"just now"` (<1m), `"Nm"`, `"Nh"`, `"Nd"`.
  - `canDrop(card: { holderTeamId: string | null }, targetTeamId: string): boolean`: false when the target is the current holder.
- **Dependencies:**
  - `@ac-1/db *`, `@chakra-ui/react ^3.37.0`, `@emotion/react ^11.14.0`, `@tanstack/react-query ^5.104.5`
  - `@tanstack/react-router` and `@tanstack/react-start`, at the same ranges as `apps/web`
  - `@atlaskit/pragmatic-drag-and-drop ^4.0.0`, `react`/`react-dom` (as in web), `vite`, `@vitejs/plugin-react`, `zod ^4.6.7`
- **Scripts:** `dev`, `build`, `start` (the production server on 3001), `typecheck`, `test` (`vitest run --coverage --passWithNoTests`).

- [ ] **Step 1: Write the failing `format.test.ts`.**
  - `originLabel({kind:"auto"}) === "Auto-routed"`
  - `originLabel({kind:"transfer", fromTeam:"Support"}) === "↪ from Support"`
  - `originLabel({kind:"transfer", fromTeam:null}) === "↪ from Unrouted"`
  - `originLabel({kind:"unrouted"}) === "Unrouted"`
  - `age` returns `"just now"` at 30 s, `"20m"`, `"2h"` and `"1d"`.
  - `canDrop` is false when `holderTeamId === target`, and true otherwise, including for unrouted.
  - No string contains `"Haiku"`.

- [ ] **Step 2: Run `npm install && npm test -w @ac-1/admin`.**
  - Expected: FAIL, because `format.ts` doesn't exist yet.

- [ ] **Step 3: Implement `format.ts`, the app shell and the read-only board.**
  - **Data:** `useQuery({ queryKey: ["board"], queryFn: () => getBoardFn(), refetchInterval: 5000 })`.
  - **Columns:** one `BoardColumn` per team, each with a count badge. The Unrouted column renders only when `unrouted.length > 0`.
  - **Cards:** a `BoardCard` shows the text clamped to 2 lines, `originLabel` and `age`.
  - **SSR:** server rendering stays on (no SPA mode). Admin needs a server.

- [ ] **Step 4: Run `npm test -w @ac-1/admin && npm run typecheck`, then `npm run dev -w @ac-1/admin`.**
  - Expected:
    - the tests and typecheck pass;
    - `curl -s localhost:3001` returns HTML;
    - in a browser, there are 5 team columns, 1 open card (the smoke-test row) under its team, and no Unrouted column.

- [ ] **Step 5: Production server and Docker.**
  - **Server command:** find the documented production server for the installed Start version, from its package README or docs, and set `start` to it.
    - Ruling: if Start needs an extra Vite plugin to emit a Node server, add it and record the ruling.
  - **Dockerfile:** add `COPY apps/admin/package.json apps/admin/` and a `FROM build AS admin` target with `WORKDIR /app/apps/admin`, `EXPOSE 3001` and `CMD` running `start` with `--host 0.0.0.0`.
  - **Compose:** an `admin` service with the same `DATABASE_URL` as web, `ports: "3001:3001"` and `depends_on: migrate (completed_successfully)`.

- [ ] **Step 6: Run `docker compose up --build -d`.**
  - Expected:
    - `curl -s localhost:3001` returns the board HTML, rendered server-side;
    - `docker compose ps` shows `admin` running and `migrate` exited 0.
  - Then run `docker compose down`, without `-v`.

- [ ] **Step 7: Commit.**
  - Message: `feat(admin): read-only team board`.

### Task 5: Drawer, Timeline, answering, Answered view

**Files:**
- Create: `app/components/SubmissionDrawer.tsx`, `app/components/Trail.tsx`, `app/components/AnsweredList.tsx`, `app/components/toaster.tsx` (Chakra v3 `createToaster` + `<Toaster/>`)
- Modify: `app/server/board.ts` (add `answerFn`), `app/routes/index.tsx` (open-card state, Board/Answered toggle), `app/lib/format.ts`, `format.test.ts`

**Interfaces:**
- Consumes: Task 3's `answerSubmission`, `BoardConflictError`, `BoardValidationError` and `MAX_NOTE_LENGTH`; Task 4's server functions.
- Produces:
  - `type ActionResult = { ok: true } | { ok: false; error: "moved" | "invalid"; message: string }`.
  - `answerFn({ submissionId, expectedHolderTeamId, body })` returns `ActionResult`. It maps `BoardConflictError` to `"moved"` and `BoardValidationError` to `"invalid"`. Anything else is rethrown.
  - `trailTitle(e: TrailEntry): string` in `format.ts`:
    - auto: `"Auto-routed to <team>"`
    - transfer: `"<from ?? "Unrouted"> → <to>"`
    - answer: `"Answered by <team>"`

- [ ] **Step 1: Write the failing `trailTitle` tests in `format.test.ts`.**
  - One test per entry kind, with the exact strings above.

- [ ] **Step 2: Run `npm test -w @ac-1/admin`.**
  - Expected: FAIL.

- [ ] **Step 3: Implement the drawer, the trail and the Answered view.**
  - **Opening:** clicking a card opens a Chakra `Drawer` (placement end) that fetches `getSubmissionFn` with query key `["submission", id]`.
  - **Drawer body:**
    - the holder, the age and the submitter's email;
    - the full text;
    - `Trail`, a Chakra `Timeline` with one item per entry. Each item shows its `trailTitle`, the reasoning, reason or body as the description, and the time. An answer entry with `backfilled` gets a `Badge` reading "Backfilled".
  - **Answering:** for open items, the footer has an answer `Textarea` with a `maxLength` of `MAX_NOTE_LENGTH` and a "Send answer" button that's disabled while the trimmed text is empty.
    - `ok`: close the drawer and invalidate `["board"]`.
    - `"moved"`: show a toast reading "This request moved", invalidate the board and refetch the detail.
    - `"invalid"`: show the message inline.
  - **Answered view:** a `SegmentedControl` or `Tabs` switch between "Board" and "Answered". The Answered list rows open the same drawer, read-only: no footer controls for answered items.

- [ ] **Step 4: Run the tests and typecheck, then test by hand in dev.**
  - Open the smoke card. Expected: the trail shows an "Auto-routed to …" entry.
  - Answer it. Expected: the card leaves the board and appears first in Answered, with no badge.
  - Open any backfilled row from Answered. Expected: one entry, "Answered by …", with a "Backfilled" badge and no auto entry.
  - Restore the dev data: `docker compose exec postgres psql …` to set the smoke row back to open (`answer`/`answeredAt` null, `answerBackfilled` false).

- [ ] **Step 5: Commit.**
  - Message: `feat(admin): submission drawer, trail and answers`.

### Task 6: Drag to transfer, reason dialog, conflicts

**Files:**
- Create: `app/components/TransferDialog.tsx`
- Modify: `app/server/board.ts` (add `transferFn`), `BoardCard.tsx` (`draggable`), `BoardColumn.tsx` (`dropTargetForElements`), `SubmissionDrawer.tsx` (the "Transfer to…" select, which opens the same dialog), `app/routes/index.tsx` (pending-transfer state)

**Interfaces:**
- Consumes: Task 3's `transferSubmission`; Task 4's `canDrop`; Task 5's `ActionResult` and toaster.
- Produces: `transferFn({ submissionId, expectedHolderTeamId: string | null, toTeamId, reason })` returns `ActionResult`, with errors mapped the same way as `answerFn`.

- [ ] **Step 1: Write the failing `transferFn` mapping test.**
  - Put the mapping in a pure helper, `toActionResult(fn: () => Promise<void>): Promise<ActionResult>`, in `app/server/result.ts`.
  - Tests:
    - `BoardConflictError("x")` gives `{ok:false,error:"moved"}`.
    - `BoardValidationError("too long")` gives `{ok:false,error:"invalid",message:"too long"}`.
    - Success gives `{ok:true}`.
    - Any other error rethrows.
  - `answerFn` from Task 5 switches to this helper as well.

- [ ] **Step 2: Run `npm test -w @ac-1/admin`.**
  - Expected: FAIL.

- [ ] **Step 3: Implement drag and drop, the dialog and the drawer's Transfer control.**
  - **Dragging:** cards use `draggable({ element, getInitialData: () => ({ submissionId, holderTeamId }) })`.
  - **Dropping:** columns use `dropTargetForElements({ element, canDrop: ({source}) => canDrop(source.data, teamId), onDragEnter/onDragLeave` (for highlighting), `onDrop` (sets the pending transfer) `})`. Each registration is cleaned up in its `useEffect`.
  - **Unrouted column:** it is a drag source but not a drop target.
  - **Reason dialog:** a pending transfer opens `TransferDialog`, a Chakra `Dialog` titled `Transfer to <team>`, with a required reason `Textarea` (`maxLength` `MAX_NOTE_LENGTH`). Its Transfer button is disabled while the trimmed reason is empty.
  - **Cancelling:** closing, pressing Esc or clicking Cancel clears the pending transfer. Nothing is saved, and the card never left its column, because the board renders from server data.
  - **Results:**
    - `ok`: invalidate `["board"]` and the open submission's detail.
    - `"moved"`: toast "This request moved" and invalidate.
    - `"invalid"`: show the message inside the dialog.
  - **Drawer control:** "Transfer to…" is a `NativeSelect` of every team except the holder, and it opens the same dialog. This is the keyboard path.

- [ ] **Step 4: Run the tests and typecheck, then test by hand in dev.**
  - Drag the smoke card to another team and cancel. Expected: it stays put, and the Transfer table count is still 0.
  - Drag it again and give a reason. Expected: it moves, the card reads "↪ from <team>", and the drawer trail shows the transfer.
  - Drop it on its own column. Expected: no highlight and no dialog.
  - Open the same card in two tabs and transfer it in tab 1. Then transfer it in tab 2. Expected: tab 2 shows the "This request moved" toast, and its board updates.
  - Run `npm run triage -- "test card for polling" --email smoke-test@example.com`. Expected: the card appears within about 5 s, without a reload.
  - Restore the dev data: delete the test transfers and the polling-test submission, and reset the smoke row's holder.

- [ ] **Step 5: Commit.**
  - Message: `feat(admin): drag to transfer with a reason`.

### Task 7: README and full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README.**
  - **"How it works":** add steps for assignment, transfers and answers. Retrieval learns from answered submissions, and backfilled answers are explained.
  - **Data model table:** update the `SuggestedTeam` and `FormSubmission` rows, and add a `Transfer` row.
  - **Layout:** add `apps/admin` to the repo layout.
  - **Docker section:** the board is at http://localhost:3001.
  - **Triage scripts table:** the eval runs over "every answered submission", and `--labels` saves "backfilled answers".
  - **Roadmap:**
    - Tick "Team board in `apps/admin`", replacing the "Admin UI…" line.
    - Add separate lines for: editing teams and guidance in admin, people and logins, sending answers by email, and the agent drafting answers.
  - **Open questions:** update "What happens when the agent can't decide?" to point at the transfer loop.

- [ ] **Step 2: Run the full verification, keys unset for the non-paid suites.**
  - Run the build, typecheck and test scripts one at a time: `npm run build && npm run typecheck && npm test`.
  - Then run `npm run test:db -w @ac-1/db && npm run test:db -w @ac-1/triage`.
  - Expected: every one passes.

- [ ] **Step 3: Check the dev DB.**
  - Expected: 16 submissions, 15 answered and backfilled, 1 open, and the 5 teams intact.

- [ ] **Step 4: Commit.**
  - Message: `docs: admin board in the README`.
