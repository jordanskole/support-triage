import type { BoardCard as Card } from "@support-triage/db";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Card as ChakraCard, HStack, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { age, originLabel } from "~/lib/format";
import type { CardDragData } from "~/lib/transfer";

export function BoardCard({
  card,
  now,
  onOpen,
}: {
  card: Card;
  now: Date;
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return draggable({
      element,
      getInitialData: (): CardDragData => ({
        submissionId: card.id,
        holderTeamId: card.holderTeamId,
      }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [card.id, card.holderTeamId]);

  return (
    <ChakraCard.Root
      ref={ref}
      size="sm"
      variant="outline"
      cursor="grab"
      opacity={dragging ? 0.4 : 1}
      onClick={() => onOpen(card.id)}
      _hover={{ borderColor: "border.emphasized" }}
    >
      <ChakraCard.Body gap="1">
        <Text lineClamp={2} fontSize="sm">
          {card.text}
        </Text>
        <HStack justify="space-between" color="fg.muted" fontSize="xs">
          <Text>{originLabel(card.origin)}</Text>
          <Text>{age(new Date(card.createdAt), now)}</Text>
        </HStack>
      </ChakraCard.Body>
    </ChakraCard.Root>
  );
}
