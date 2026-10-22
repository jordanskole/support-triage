import { describe, expect, it } from "vitest";
import {
  ClassificationError,
  claudeClassifier,
  type ClassifyInput,
  type MessagesClient,
  type ParseResult,
} from "./classifier.js";

const input: ClassifyInput = {
  request: "Can I get a refund?",
  guidance: "g",
  teams: [
    { name: "Support", description: "help" },
    { name: "Sales", description: "buy" },
  ],
  neighbours: [],
};

function stubClient(result: Partial<ParseResult>) {
  const calls: Parameters<MessagesClient["messages"]["parse"]>[0][] = [];
  const client: MessagesClient = {
    messages: {
      async parse(params) {
        calls.push(params);
        return {
          stop_reason: "end_turn",
          parsed_output: { team: "Sales", reasoning: "buying" },
          usage: { input_tokens: 100, output_tokens: 20 },
          ...result,
        };
      },
    },
  };
  return { client, calls };
}

describe("claudeClassifier", () => {
  it("asks Haiku for the team as an enum of the given team names", async () => {
    const { client, calls } = stubClient({});
    await claudeClassifier({ client }).classify(input);

    const params = calls[0]!;
    expect(params.model).toBe("claude-haiku-5-5");
    const format = params.output_config?.format as {
      schema: { properties: { team: { enum: string[] } } };
    };
    expect(format.schema.properties.team.enum).toEqual(["Support", "Sales"]);
  });

  it("returns team, reasoning and token usage", async () => {
    const { client } = stubClient({});
    expect(await claudeClassifier({ client }).classify(input)).toEqual({
      team: "Sales",
      reasoning: "buying",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  it("maps a team that differs only in capitalisation to the real name", async () => {
    const { client } = stubClient({ parsed_output: { team: "sales", reasoning: "x" } });
    expect((await claudeClassifier({ client }).classify(input)).team).toBe("Sales");
  });

  it.each([
    ["refusal", { stop_reason: "refusal" }],
    ["max_tokens", { stop_reason: "max_tokens" }],
    ["null parsed_output", { parsed_output: null }],
    ["an unknown team", { parsed_output: { team: "Legal", reasoning: "x" } }],
    ["missing reasoning", { parsed_output: { team: "Sales" } }],
  ] as const)("throws ClassificationError on %s", async (_label, result) => {
    const { client } = stubClient(result as Partial<ParseResult>);
    await expect(claudeClassifier({ client }).classify(input)).rejects.toBeInstanceOf(
      ClassificationError,
    );
  });
});
