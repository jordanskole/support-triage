import { MAX_NOTE_LENGTH } from "@support-triage/db/limits";
import type { SubmissionDetail } from "@support-triage/db";
import {
  Button,
  CloseButton,
  Drawer,
  Field,
  NativeSelect,
  Portal,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { transferTargets } from "~/lib/format";
import type { PendingTransfer } from "~/lib/transfer";
import { answerFn, getSubmissionFn } from "~/server/board";
import { toaster } from "./toaster";
import { Trail } from "./Trail";

type Team = { id: string; name: string };

export function SubmissionDrawer({
  id,
  teams,
  onClose,
  onTransfer,
}: {
  id: string | null;
  teams: Team[];
  onClose: () => void;
  onTransfer: (pending: PendingTransfer) => void;
}) {
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
              <Body detail={detail.data} teams={teams} onClose={onClose} onTransfer={onTransfer} />
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

function Body({
  detail,
  teams,
  onClose,
  onTransfer,
}: {
  detail: SubmissionDetail;
  teams: Team[];
  onClose: () => void;
  onTransfer: (pending: PendingTransfer) => void;
}) {
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
      {detail.status !== "answered" && (
        <Drawer.Footer>
          <Stack w="full" gap="4">
            <Field.Root>
              <Field.Label>Not ours? Transfer it</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value=""
                  onChange={(e) => {
                    const toTeam = teams.find((t) => t.id === e.currentTarget.value);
                    if (toTeam) {
                      onTransfer({
                        submissionId: detail.id,
                        expectedHolderTeamId: holder?.id ?? null,
                        toTeam,
                      });
                    }
                  }}
                >
                  <option value="" disabled>
                    Transfer to…
                  </option>
                  {transferTargets(teams, holder?.id ?? null).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            {holder && (
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
            )}
            {holder && (
              <Button
                alignSelf="end"
                onClick={send}
                loading={sending}
                disabled={answer.trim() === ""}
              >
                Send answer
              </Button>
            )}
          </Stack>
        </Drawer.Footer>
      )}
    </>
  );
}
