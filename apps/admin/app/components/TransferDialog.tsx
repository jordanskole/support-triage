import { MAX_NOTE_LENGTH } from "@ac-1/db/limits";
import { Button, CloseButton, Dialog, Field, Portal, Textarea } from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PendingTransfer } from "~/lib/transfer";
import { transferFn } from "~/server/board";
import { toaster } from "./toaster";

/**
 * Asks why a request belongs to the team it's being moved to. Nothing is saved
 * until the reason is sent; closing the dialog leaves the card where it was.
 */
export function TransferDialog({
  pending,
  onClose,
}: {
  pending: PendingTransfer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setReason("");
    setError(null);
  }, [pending]);

  async function send() {
    if (!pending) return;
    setSending(true);
    setError(null);
    const result = await transferFn({
      data: {
        submissionId: pending.submissionId,
        expectedHolderTeamId: pending.expectedHolderTeamId,
        toTeamId: pending.toTeam.id,
        reason,
      },
    }).finally(() => setSending(false));
    if (result.ok || result.error === "moved") {
      if (!result.ok) toaster.create({ title: "This request moved", type: "warning" });
      onClose();
    } else {
      setError(result.message);
    }
    await queryClient.invalidateQueries({ queryKey: ["board"] });
    await queryClient.invalidateQueries({ queryKey: ["submission", pending.submissionId] });
  }

  return (
    <Dialog.Root open={pending !== null} onOpenChange={(e) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Transfer to {pending?.toTeam.name}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Field.Root invalid={error !== null} required>
                <Field.Label>Why does it belong there?</Field.Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={MAX_NOTE_LENGTH}
                  rows={3}
                  autoFocus
                />
                {error && <Field.ErrorText>{error}</Field.ErrorText>}
              </Field.Root>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button onClick={send} loading={sending} disabled={reason.trim() === ""}>
                Transfer
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
