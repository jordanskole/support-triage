import type { PrismaClient } from "../generated/prisma/client.js";
import type { ImportPlan } from "./map.js";

export interface ImportCounts {
  teams: number;
  users: number;
  formSubmissions: number;
  suggestedTeams: number;
}

// Inserts in foreign-key order and skips rows whose id (or unique field)
// already exists, so re-running is a no-op and seeded or Studio-edited rows
// are left as they are. Returns the row counts after the import.
export async function applyImport(db: PrismaClient, plan: ImportPlan): Promise<ImportCounts> {
  return db.$transaction(async (tx) => {
    await tx.team.createMany({ data: plan.teams, skipDuplicates: true });
    await tx.user.createMany({ data: plan.users, skipDuplicates: true });
    await tx.formSubmission.createMany({ data: plan.formSubmissions, skipDuplicates: true });
    await tx.suggestedTeam.createMany({ data: plan.suggestedTeams, skipDuplicates: true });
    return {
      teams: await tx.team.count(),
      users: await tx.user.count(),
      formSubmissions: await tx.formSubmission.count(),
      suggestedTeams: await tx.suggestedTeam.count(),
    };
  });
}
