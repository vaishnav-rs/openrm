import { OpenAIProvider } from "./openai.js";

/**
 * Generic client for any OpenAI-compatible chat/embeddings endpoint (Groq,
 * OpenRouter, Together, vLLM's OpenAI-compat server, etc). It's the same
 * shape as OpenAIProvider, just with a required, user-configured baseUrl.
 */
export class OpenAICompatibleProvider extends OpenAIProvider {
  override readonly name = "openai-compatible";

  constructor(config: { apiKey: string; baseUrl: string; model: string; embeddingModel?: string }) {
    super(config);
  }
}
