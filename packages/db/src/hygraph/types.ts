// Hygraph DRAFT-stage records as fetched for the one-time import. Hygraph
// fields are nullable even where our schema requires them; map.ts validates.

type Ref = { id: string } | null;

interface HygraphRecord {
  id: string;
  createdAt: string;
}

export interface HygraphTeam extends HygraphRecord {
  name: string | null;
  description: string | null;
}

export interface HygraphCustomer extends HygraphRecord {
  firstName: string | null;
  lastName: string | null;
  email: string[];
}

export interface HygraphFormSubmission extends HygraphRecord {
  submittedValue: string | null;
  customer: Ref;
}

export interface HygraphSuggestedTeam extends HygraphRecord {
  reasoning: string | null;
  hitlVerified: boolean | null;
  correctedReasoning: string | null;
  formSubmission: Ref;
  team: Ref;
  correctedTeam: Ref;
}

export interface HygraphSnapshot {
  teams: HygraphTeam[];
  customers: HygraphCustomer[];
  formSubmissions: HygraphFormSubmission[];
  suggestedTeams: HygraphSuggestedTeam[];
}
