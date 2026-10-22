import type { BoardCard as Card } from "@ac-1/db";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Badge, HStack, Heading, Stack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { canDrop } from "~/lib/format";
import { type CardDragData, isCardDragData } from "~/lib/transfer";
import { BoardCard } from "./BoardCard";

export function BoardColumn({
  team,
  name,
  cards,
  now,
  onOpen,
  onDropCard,
}: {
  /** The team this column is, or null for the Unrouted column, which accepts no drops. */
  team: { id: string; name: string } | null;
  name: string;
  cards: Card[];
  now: Date;
  onOpen: (id: string) => void;
  onDropCard: (card: CardDragData, team: { id: string; name: string }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !team) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isCardDragData(source.data) && canDrop(source.data, team.id),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        if (isCardDragData(source.data)) onDropCard(source.data, team);
      },
    });
  }, [team, onDropCard]);

  return (
    <Stack
      ref={ref}
      minW="240px"
      flex="1"
      gap="2"
      p="2"
      bg={over ? "blue.subtle" : "bg.muted"}
      outline={over ? "2px dashed" : undefined}
      outlineColor="blue.solid"
      rounded="md"
      minH="120px"
    >
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
