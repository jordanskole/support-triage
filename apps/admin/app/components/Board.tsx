import type { Board as BoardData } from "@ac-1/db";
import { HStack } from "@chakra-ui/react";
import { BoardColumn } from "./BoardColumn";

export function Board({ board, now }: { board: BoardData; now: Date }) {
  return (
    <HStack align="start" gap="3" overflowX="auto" pb="2">
      {board.unrouted.length > 0 && <BoardColumn name="Unrouted" cards={board.unrouted} now={now} />}
      {board.teams.map((team) => (
        <BoardColumn key={team.id} name={team.name} cards={team.cards} now={now} />
      ))}
    </HStack>
  );
}
