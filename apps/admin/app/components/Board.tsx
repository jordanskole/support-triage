import type { Board as BoardData } from "@support-triage/db";
import { HStack } from "@chakra-ui/react";
import type { CardDragData } from "~/lib/transfer";
import { BoardColumn } from "./BoardColumn";

export function Board({
  board,
  now,
  onOpen,
  onDropCard,
}: {
  board: BoardData;
  now: Date;
  onOpen: (id: string) => void;
  onDropCard: (card: CardDragData, team: { id: string; name: string }) => void;
}) {
  return (
    <HStack align="start" gap="3" overflowX="auto" pb="2">
      {board.unrouted.length > 0 && (
        <BoardColumn
          team={null}
          name="Unrouted"
          cards={board.unrouted}
          now={now}
          onOpen={onOpen}
          onDropCard={onDropCard}
        />
      )}
      {board.teams.map((team) => (
        <BoardColumn
          key={team.id}
          team={team}
          name={team.name}
          cards={team.cards}
          now={now}
          onOpen={onOpen}
          onDropCard={onDropCard}
        />
      ))}
    </HStack>
  );
}
