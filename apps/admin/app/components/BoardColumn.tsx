import type { BoardCard as Card } from "@ac-1/db";
import { Badge, HStack, Heading, Stack } from "@chakra-ui/react";
import { BoardCard } from "./BoardCard";

export function BoardColumn({
  name,
  cards,
  now,
  onOpen,
}: {
  name: string;
  cards: Card[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  return (
    <Stack minW="240px" flex="1" gap="2" p="2" bg="bg.muted" rounded="md">
      <HStack justify="space-between">
        <Heading size="sm">{name}</Heading>
        <Badge>{cards.length}</Badge>
      </HStack>
      {cards.map((card) => (
        <BoardCard key={card.id} card={card} now={now} onOpen={onOpen} />
      ))}
    </Stack>
  );
}
