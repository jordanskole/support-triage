import { z } from "zod";

export const Example = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type ExampleT = z.infer<typeof Example>;

export function parseExample(input: unknown): ExampleT {
  return Example.parse(input);
}
