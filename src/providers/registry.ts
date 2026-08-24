import { getPrisma } from "../db/prisma.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

/**
 * Reads the isActive=true ProviderConfig row from the database (no caching
 * beyond this single call, so provider swaps made in the Providers screen
 * take effect on the very next message) and returns a configured provider
 * instance.
 */
export async function getActiveProvider(): Promise<LLMProvider> {
  const prisma = getPrisma();
  const config = await prisma.providerConfig.findFirst({
    where: { isActive: true },
  });

  if (!config) {
    throw new Error(
      "No active provider configured. Use the Providers screen (or `openrm init`) to add and activate one."
    );
  }

  return instantiateProvider({
    name: config.name,
    apiKey: config.apiKey ?? undefined,
    baseUrl: config.baseUrl ?? undefined,
    model: config.model,
    embeddingModel: config.embeddingModel ?? undefined,
  });
}

export interface ProviderConfigLike {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  embeddingModel?: string;
}

export function instantiateProvider(config: ProviderConfigLike): LLMProvider {
  switch (config.name) {
    case "ollama":
      return new OllamaProvider({
        model: config.model,
        embeddingModel: config.embeddingModel,
        baseUrl: config.baseUrl,
      });
    case "openai":
      if (!config.apiKey) throw new Error("OpenAI provider requires an apiKey");
      return new OpenAIProvider({
        apiKey: config.apiKey,
        model: config.model,
        embeddingModel: config.embeddingModel,
        baseUrl: config.baseUrl,
      });
    case "anthropic":
      if (!config.apiKey) throw new Error("Anthropic provider requires an apiKey");
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      });
    case "openai-compatible":
      if (!config.apiKey) throw new Error("openai-compatible provider requires an apiKey");
      if (!config.baseUrl) throw new Error("openai-compatible provider requires a baseUrl");
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        embeddingModel: config.embeddingModel,
      });
    default:
      throw new Error(`Unknown provider name: ${config.name}`);
  }
}
