import Anthropic from "@anthropic-ai/sdk";
import { claudeClassifier } from "../classifier.js";
import { voyageEmbedder } from "../embedder.js";

export function realClients(env: { ANTHROPIC_API_KEY: string; VOYAGE_API_KEY: string }) {
  return {
    embedder: voyageEmbedder({ apiKey: env.VOYAGE_API_KEY }),
    classifier: claudeClassifier({ client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) }),
  };
}
