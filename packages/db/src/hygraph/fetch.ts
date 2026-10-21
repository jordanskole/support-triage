import type { HygraphSnapshot } from "./types.js";

export interface HygraphConfig {
  endpoint: string;
  token: string;
}

export function readHygraphConfig(env: NodeJS.ProcessEnv): HygraphConfig {
  const missing = ["HYGRAPH_ENDPOINT", "HYGRAPH_TOKEN"].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} must be set to run the Hygraph import ` +
        "(Hygraph → Project Settings → Endpoints / Permanent Auth Tokens)",
    );
  }
  return { endpoint: env.HYGRAPH_ENDPOINT!.trim(), token: env.HYGRAPH_TOKEN!.trim() };
}

const PAGE_SIZE = 100;

// Selection set per snapshot key. Relations come back as `{ id }`.
const SELECTIONS: Record<keyof HygraphSnapshot, string> = {
  teams: "id createdAt name description",
  customers: "id createdAt firstName lastName email",
  formSubmissions: "id createdAt submittedValue customer { id }",
  suggestedTeams:
    "id createdAt reasoning hitlVerified correctedReasoning formSubmission { id } team { id } correctedTeam { id }",
};

async function fetchAll<K extends keyof HygraphSnapshot>(
  config: HygraphConfig,
  fetchImpl: typeof fetch,
  field: K,
): Promise<HygraphSnapshot[K]> {
  const query = `query Page($first: Int!, $skip: Int!) {
    ${field}(stage: DRAFT, first: $first, skip: $skip, orderBy: createdAt_ASC) { ${SELECTIONS[field]} }
  }`;
  const rows: HygraphSnapshot[K][number][] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const res = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { first: PAGE_SIZE, skip } }),
    });
    if (!res.ok) throw new Error(`Hygraph ${field} request failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: Record<string, HygraphSnapshot[K]> | null;
      errors?: { message: string }[];
    };
    if (json.errors?.length) {
      throw new Error(`Hygraph ${field} query failed: ${json.errors[0]!.message}`);
    }
    const page = json.data?.[field] ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows as HygraphSnapshot[K];
  }
}

export async function fetchHygraphSnapshot(
  config: HygraphConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<HygraphSnapshot> {
  return {
    teams: await fetchAll(config, fetchImpl, "teams"),
    customers: await fetchAll(config, fetchImpl, "customers"),
    formSubmissions: await fetchAll(config, fetchImpl, "formSubmissions"),
    suggestedTeams: await fetchAll(config, fetchImpl, "suggestedTeams"),
  };
}
