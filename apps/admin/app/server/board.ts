import { answerSubmission, getAnswered, getBoard, getSubmissionDetail } from "@ac-1/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { toActionResult } from "./result";

export const getBoardFn = createServerFn({ method: "GET" }).handler(() => getBoard(getDb()));

export const getAnsweredFn = createServerFn({ method: "GET" }).handler(() =>
  getAnswered(getDb()),
);

export const getSubmissionFn = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(({ data }) => getSubmissionDetail(getDb(), data.id));

export const answerFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      submissionId: z.string().min(1),
      expectedHolderTeamId: z.string().min(1),
      body: z.string(),
    }),
  )
  .handler(({ data }) => toActionResult(() => answerSubmission(getDb(), data)));
