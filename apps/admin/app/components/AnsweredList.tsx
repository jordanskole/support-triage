import { Badge, HStack, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { getAnsweredFn } from "~/server/board";

export function AnsweredList({ onOpen }: { onOpen: (id: string) => void }) {
  const answered = useQuery({ queryKey: ["answered"], queryFn: () => getAnsweredFn() });
  if (!answered.data) return <Spinner />;
  if (answered.data.length === 0) return <Text color="fg.muted">Nothing answered yet.</Text>;
  return (
    <Table.Root size="sm" interactive>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Request</Table.ColumnHeader>
          <Table.ColumnHeader>Answered by</Table.ColumnHeader>
          <Table.ColumnHeader>When</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {answered.data.map((item) => (
          <Table.Row key={item.id} onClick={() => onOpen(item.id)} cursor="pointer">
            <Table.Cell>
              <Stack gap="0">
                <Text lineClamp={1}>{item.text}</Text>
              </Stack>
            </Table.Cell>
            <Table.Cell>
              <HStack>
                <Text>{item.team}</Text>
                {item.backfilled && <Badge colorPalette="purple">Backfilled</Badge>}
              </HStack>
            </Table.Cell>
            <Table.Cell>{new Date(item.answeredAt).toLocaleString()}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
