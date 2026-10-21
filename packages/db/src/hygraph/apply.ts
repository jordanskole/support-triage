import type { PrismaClient } from "../generated/prisma/client.js";
import { ImportError, type ImportPlan } from "./map.js";

export interface ImportCounts {
  teams: number;
  users: number;
  formSubmissions: number;
  suggestedTeams: number;
}

// Throws if any planned id is absent after its insert. `skipDuplicates` also
// skips rows that clash on another unique field (Team.name, User.email), and
// those would otherwise vanish behind the totals.
function assertAllPresent(model: string, planned: { id?: string }[], present: { id: string }[]) {
  const found = new Set(present.map((row) => row.id));
  const missing = planned.map((row) => row.id!).filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ImportError(
      `${model} rows skipped because another row already uses their unique name/email/submission: ${missing.join(", ")}`,
    );
  }
}

// Inserts in foreign-key order and skips rows whose id already exists, so
// re-running is a no-op and seeded or Studio-edited rows are left as they
// are. Returns the row counts after the import.
export async function applyImport(db: PrismaClient, plan: ImportPlan): Promise<ImportCounts> {
  return db.$transaction(async (tx) => {
    const ids = (rows: { id?: string }[]) => ({ where: { id: { in: rows.map((r) => r.id!) } }, select: { id: true } });

    await tx.team.createMany({ data: plan.teams, skipDuplicates: true });
    assertAllPresent("Team", plan.teams, await tx.team.findMany(ids(plan.teams)));

    await tx.user.createMany({ data: plan.users, skipDuplicates: true });
    assertAllPresent("User", plan.users, await tx.user.findMany(ids(plan.users)));

    await tx.formSubmission.createMany({ data: plan.formSubmissions, skipDuplicates: true });
    await tx.suggestedTeam.createMany({ data: plan.suggestedTeams, skipDuplicates: true });
    // SuggestedTeam.formSubmissionId is unique too.
    assertAllPresent("SuggestedTeam", plan.suggestedTeams, await tx.suggestedTeam.findMany(ids(plan.suggestedTeams)));
    return {
      teams: await tx.team.count(),
      users: await tx.user.count(),
      formSubmissions: await tx.formSubmission.count(),
      suggestedTeams: await tx.suggestedTeam.count(),
    };
  });
}
