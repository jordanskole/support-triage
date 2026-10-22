import { Box, Heading, Spinner, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Board } from "~/components/Board";
import { getBoardFn } from "~/server/board";

/** How often the board refetches, so new triage results and other people's moves show up. */
const POLL_MS = 5000;

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
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
      {board.data ? (
        <Board board={board.data} now={new Date(board.dataUpdatedAt)} />
      ) : board.error ? (
        <Text color="fg.error">Couldn't load the board: {board.error.message}</Text>
      ) : (
        <Spinner />
      )}
    </Box>
  );
}
