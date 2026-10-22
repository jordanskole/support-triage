import { getAnswered, getBoard, getSubmissionDetail } from "@ac-1/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";

export const getBoardFn = createServerFn({ method: "GET" }).handler(() => getBoard(getDb()));

export const getAnsweredFn = createServerFn({ method: "GET" }).handler(() =>
  getAnswered(getDb()),
);

export const getSubmissionFn = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(({ data }) => getSubmissionDetail(getDb(), data.id));
