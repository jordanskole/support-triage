import type { Prisma } from "../generated/prisma/client.js";
import type { HygraphCustomer, HygraphSnapshot } from "./types.js";

export interface ImportPlan {
  teams: Prisma.TeamCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  formSubmissions: Prisma.FormSubmissionCreateManyInput[];
  suggestedTeams: Prisma.SuggestedTeamCreateManyInput[];
}

export class ImportError extends Error {
  override name = "ImportError";
}

/**
 * Reduce a Hygraph customer's `email` list to the single address `User.email`
 * stores, or explain why it can't be done.
 *
 * Returns `{ email }` on success or `{ problem }`, a short reason such as
 * "has no email". The caller prefixes the problem with the customer id and
 * reports it along with every other bad record.
 *
 * The result is what `User.email @unique` compares, so whatever
 * normalization happens here decides which addresses count as "the same
 * person".
 */
export function customerEmail(
  customer: HygraphCustomer,
): { email: string } | { problem: string } {
  switch (customer.email.length) {
    case 0:
      return { problem: "has no email" };
    case 1:
      return { email: customer.email[0] };
    default:
      return { problem: `has ${customer.email.length} emails` };
  }
}

function hasText(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

export function mapSnapshot(snapshot: HygraphSnapshot): ImportPlan {
  const problems: string[] = [];
  const plan: ImportPlan = { teams: [], users: [], formSubmissions: [], suggestedTeams: [] };

  for (const t of snapshot.teams) {
    if (!hasText(t.name)) problems.push(`Team ${t.id}: name is empty`);
    if (!hasText(t.description)) problems.push(`Team ${t.id}: description is empty`);
    if (hasText(t.name) && hasText(t.description)) {
      plan.teams.push({ id: t.id, createdAt: new Date(t.createdAt), name: t.name, description: t.description });
    }
  }

  const customerByEmail = new Map<string, string>();
  for (const c of snapshot.customers) {
    const result = customerEmail(c);
    if ("problem" in result) {
      problems.push(`Customer ${c.id}: ${result.problem}`);
      continue;
    }
    const clash = customerByEmail.get(result.email);
    if (clash) {
      problems.push(`Customer ${c.id}: same email as Customer ${clash}`);
      continue;
    }
    customerByEmail.set(result.email, c.id);
    plan.users.push({
      id: c.id,
      createdAt: new Date(c.createdAt),
      email: result.email,
      firstName: c.firstName,
      lastName: c.lastName,
    });
  }

  for (const f of snapshot.formSubmissions) {
    if (!hasText(f.submittedValue)) problems.push(`FormSubmission ${f.id}: submittedValue is empty`);
    if (!f.customer) problems.push(`FormSubmission ${f.id}: has no customer`);
    if (hasText(f.submittedValue) && f.customer) {
      plan.formSubmissions.push({
        id: f.id,
        createdAt: new Date(f.createdAt),
        submittedValue: f.submittedValue,
        userId: f.customer.id,
      });
    }
  }

  for (const s of snapshot.suggestedTeams) {
    if (!s.team) problems.push(`SuggestedTeam ${s.id}: has no team`);
    if (!s.formSubmission) problems.push(`SuggestedTeam ${s.id}: has no formSubmission`);
    if (!hasText(s.reasoning)) problems.push(`SuggestedTeam ${s.id}: reasoning is empty`);
    if (s.team && s.formSubmission && hasText(s.reasoning)) {
      plan.suggestedTeams.push({
        id: s.id,
        createdAt: new Date(s.createdAt),
        reasoning: s.reasoning,
        hitlVerified: s.hitlVerified ?? false,
        correctedReasoning: s.correctedReasoning,
        formSubmissionId: s.formSubmission.id,
        teamId: s.team.id,
        correctedTeamId: s.correctedTeam?.id ?? null,
      });
    }
  }

  if (problems.length > 0) {
    throw new ImportError(`Hygraph data can't be imported:\n${problems.join("\n")}`);
  }
  return plan;
}
