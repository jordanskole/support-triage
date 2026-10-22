import type Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { Neighbour } from "@ac-1/db";
import { z } from "zod";
import { buildPrompt } from "./prompt.js";

export const TRIAGE_MODEL = "claude-haiku-5-5";

export type ClassifyInput = {
  request: string;
  /** How to weigh past decisions against descriptions; stored in the `Setting` table. */
  guidance: string;
  teams: { name: string; description: string }[];
  neighbours: Neighbour[];
};

export type Classification = {
  team: string;
  reasoning: string;
  usage: { inputTokens: number; outputTokens: number };
};

export interface Classifier {
  classify(input: ClassifyInput): Promise<Classification>;
}

export class ClassificationError extends Error {
  override name = "ClassificationError";
}

/** The slice of a Messages API response the classifier reads. */
export type ParseResult = {
  stop_reason: string | null;
  parsed_output: unknown;
  usage: { input_tokens: number; output_tokens: number };
};

/** The slice of the Anthropic client the classifier needs; tests pass a stub. */
export type MessagesClient = {
  messages: {
    parse(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<ParseResult>;
  };
};

const Answer = z.object({ team: z.string(), reasoning: z.string().min(1) });

export function claudeClassifier(opts: { client: MessagesClient; model?: string }): Classifier {
  const model = opts.model ?? TRIAGE_MODEL;

  return {
    async classify(input) {
      const names = input.teams.map((t) => t.name);
      const { system, user } = buildPrompt(input);

      const response = await opts.client.messages.parse({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          // transform: false keeps `enum`, which the API enforces; the SDK's default
          // transform would demote it to a description.
          format: jsonSchemaOutputFormat(
            {
              type: "object",
              properties: {
                team: { type: "string", enum: names },
                reasoning: { type: "string" },
              },
              required: ["team", "reasoning"],
              additionalProperties: false,
            },
            { transform: false },
          ),
        },
      });

      if (response.stop_reason !== "end_turn") {
        throw new ClassificationError(`Claude stopped with "${response.stop_reason}"`);
      }
      const answer = Answer.safeParse(response.parsed_output);
      if (!answer.success) {
        throw new ClassificationError(`Claude returned an unexpected answer: ${answer.error.message}`);
      }
      // Structured outputs don't guarantee the capitalisation of enum values.
      const team = names.find((n) => n.toLowerCase() === answer.data.team.toLowerCase());
      if (!team) {
        throw new ClassificationError(`Claude picked "${answer.data.team}", which is not a team`);
      }

      return {
        team,
        reasoning: answer.data.reasoning,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
