import { Box, Heading, Spinner, Tabs, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AnsweredList } from "~/components/AnsweredList";
import { Board } from "~/components/Board";
import { SubmissionDrawer } from "~/components/SubmissionDrawer";
import { Toaster } from "~/components/toaster";
import { getBoardFn } from "~/server/board";

/** How often the board refetches, so new triage results and other people's moves show up. */
const POLL_MS = 5000;

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [openId, setOpenId] = useState<string | null>(null);
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
            <Board board={board.data} now={new Date(board.dataUpdatedAt)} onOpen={setOpenId} />
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
      <SubmissionDrawer id={openId} onClose={() => setOpenId(null)} />
      <Toaster />
    </Box>
  );
}
