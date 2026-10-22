import { MAX_NOTE_LENGTH } from "@ac-1/db/limits";
import type { SubmissionDetail } from "@ac-1/db";
import {
  Button,
  CloseButton,
  Drawer,
  Field,
  Portal,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { answerFn, getSubmissionFn } from "~/server/board";
import { toaster } from "./toaster";
import { Trail } from "./Trail";

export function SubmissionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmissionFn({ data: { id: id! } }),
    enabled: id !== null,
  });

  return (
    <Drawer.Root open={id !== null} onOpenChange={(e) => !e.open && onClose()} size="md">
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content>
            <Drawer.Header>
              <Drawer.Title>Request</Drawer.Title>
            </Drawer.Header>
            {detail.data ? (
              <Body detail={detail.data} onClose={onClose} />
            ) : detail.data === null ? (
              <Drawer.Body>This request no longer exists.</Drawer.Body>
            ) : (
              <Drawer.Body>
                <Spinner />
              </Drawer.Body>
            )}
            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}

function Body({ detail, onClose }: { detail: SubmissionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const holder = detail.holder;

  async function send() {
    if (!holder) return;
    setSending(true);
    setError(null);
    const result = await answerFn({
      data: { submissionId: detail.id, expectedHolderTeamId: holder.id, body: answer },
    }).finally(() => setSending(false));
    if (result.ok) {
      setAnswer("");
      onClose();
    } else if (result.error === "moved") {
      toaster.create({ title: "This request moved", type: "warning" });
    } else {
      setError(result.message);
    }
    await queryClient.invalidateQueries({ queryKey: ["board"] });
    await queryClient.invalidateQueries({ queryKey: ["answered"] });
    await queryClient.invalidateQueries({ queryKey: ["submission", detail.id] });
  }

  return (
    <>
      <Drawer.Body>
        <Stack gap="5">
          <Text color="fg.muted" textStyle="sm">
            {holder ? `Held by ${holder.name}` : "Unrouted"} · from {detail.email} ·{" "}
            {new Date(detail.createdAt).toLocaleString()}
          </Text>
          <Text fontWeight="medium" whiteSpace="pre-wrap">
            {detail.text}
          </Text>
          <Trail trail={detail.trail} />
        </Stack>
      </Drawer.Body>
      {detail.status === "open" && (
        <Drawer.Footer>
          <Stack w="full">
            <Field.Root invalid={error !== null}>
              <Field.Label>Answer the customer</Field.Label>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={MAX_NOTE_LENGTH}
                rows={4}
                placeholder="Write the answer. Sending it closes the request."
              />
              {error && <Field.ErrorText>{error}</Field.ErrorText>}
            </Field.Root>
            <Button
              alignSelf="end"
              onClick={send}
              loading={sending}
              disabled={answer.trim() === ""}
            >
              Send answer
            </Button>
          </Stack>
        </Drawer.Footer>
      )}
    </>
  );
}
