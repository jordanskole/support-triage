import type { TrailEntry } from "@support-triage/db";
import { Badge, HStack, Text, Timeline } from "@chakra-ui/react";
import { trailTitle } from "~/lib/format";

const detail = (e: TrailEntry) =>
  e.kind === "auto" ? e.reasoning : e.kind === "transfer" ? e.reason : e.body;

/** The submission's history: the automatic pick, each transfer, then the answer. */
export function Trail({ trail }: { trail: TrailEntry[] }) {
  if (trail.length === 0) return <Text color="fg.muted">Not routed to a team yet.</Text>;
  return (
    <Timeline.Root size="sm">
      {trail.map((entry, i) => (
        <Timeline.Item key={i}>
          <Timeline.Connector>
            <Timeline.Separator />
            <Timeline.Indicator />
          </Timeline.Connector>
          <Timeline.Content>
            <HStack>
              <Timeline.Title>{trailTitle(entry)}</Timeline.Title>
              {entry.kind === "answer" && entry.backfilled && (
                <Badge colorPalette="purple">Backfilled</Badge>
              )}
            </HStack>
            <Timeline.Description>{new Date(entry.at).toLocaleString()}</Timeline.Description>
            <Text textStyle="sm" whiteSpace="pre-wrap">
              {detail(entry)}
            </Text>
          </Timeline.Content>
        </Timeline.Item>
      ))}
    </Timeline.Root>
  );
}
