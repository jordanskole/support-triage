import { Box, Heading, Spinner, Tabs, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AnsweredList } from "~/components/AnsweredList";
import { Board } from "~/components/Board";
import { SubmissionDrawer } from "~/components/SubmissionDrawer";
import { Toaster } from "~/components/toaster";
import { TransferDialog } from "~/components/TransferDialog";
import type { CardDragData, PendingTransfer } from "~/lib/transfer";
import { getBoardFn } from "~/server/board";

/** How often the board refetches, so new triage results and other people's moves show up. */
const POLL_MS = 5000;

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const onDropCard = useCallback(
    (card: CardDragData, toTeam: { id: string; name: string }) =>
      setPending({
        submissionId: card.submissionId,
        expectedHolderTeamId: card.holderTeamId,
        toTeam,
      }),
    [],
  );
  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => getBoardFn(),
    refetchInterval: POLL_MS,
  });

  return (
    <Box p="4">
      <Heading size="lg" mb="4">
        Requests
      </Heading>
      <Tabs.Root defaultValue="board" lazyMount unmountOnExit>
        <Tabs.List mb="4">
          <Tabs.Trigger value="board">Board</Tabs.Trigger>
          <Tabs.Trigger value="answered">Answered</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="board">
          {board.data ? (
            <Board
              board={board.data}
              now={new Date(board.dataUpdatedAt)}
              onOpen={setOpenId}
              onDropCard={onDropCard}
            />
          ) : board.error ? (
            <Text color="fg.error">Couldn't load the board: {board.error.message}</Text>
          ) : (
            <Spinner />
          )}
        </Tabs.Content>
        <Tabs.Content value="answered">
          <AnsweredList onOpen={setOpenId} />
        </Tabs.Content>
      </Tabs.Root>
      <SubmissionDrawer
        id={openId}
        teams={board.data?.teams ?? []}
        onClose={() => setOpenId(null)}
        onTransfer={setPending}
      />
      <TransferDialog pending={pending} onClose={() => setPending(null)} />
      <Toaster />
    </Box>
  );
}
