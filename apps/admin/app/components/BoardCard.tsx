import type { BoardCard as Card } from "@ac-1/db";
import { Card as ChakraCard, HStack, Text } from "@chakra-ui/react";
import { age, originLabel } from "~/lib/format";

export function BoardCard({
  card,
  now,
  onOpen,
}: {
  card: Card;
  now: Date;
  onOpen: (id: string) => void;
}) {
  return (
    <ChakraCard.Root
      size="sm"
      variant="outline"
      cursor="pointer"
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
