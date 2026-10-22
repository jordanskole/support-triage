/** A transfer the user has started (by dropping or from the drawer) but not yet given a reason for. */
export type PendingTransfer = {
  submissionId: string;
  expectedHolderTeamId: string | null;
  toTeam: { id: string; name: string };
};

/** What a dragged card carries, so a column can decide whether it accepts it. */
export type CardDragData = { submissionId: string; holderTeamId: string | null };

export function isCardDragData(data: Record<string | symbol, unknown>): data is CardDragData {
  return typeof data.submissionId === "string" && "holderTeamId" in data;
}
