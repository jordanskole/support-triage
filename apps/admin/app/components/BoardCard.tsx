import type { BoardCard as Card } from "@ac-1/db";
import { Card as ChakraCard, HStack, Text } from "@chakra-ui/react";
import { age, originLabel } from "~/lib/format";

export function BoardCard({ card, now }: { card: Card; now: Date }) {
  return (
    <ChakraCard.Root size="sm" variant="outline">
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
