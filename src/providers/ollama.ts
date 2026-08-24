import type {
  ChatMessage,
  ChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";
import { pullOllamaModel } from "./ollama-pull.js";

export interface OllamaProviderConfig {
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

// A dedicated embedding model to fall back to when the user hasn't
// configured one explicitly. Most chat models don't serve /api/embeddings
// well (or at all), so this must NOT be the chat model.
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
}

interface OllamaEmbeddingsResponse {
  embedding: number[];
}

/**
 * Ollama provider via its local HTTP API: /api/chat (supports a `tools`
 * param on tool-capable models) and /api/embeddings.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;

  constructor(config: OllamaProviderConfig) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.model = config.model;
    this.embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResult> {
    const ollamaMessages = messages.map((m) => ({
      role: m.role === "tool" ? "tool" : m.role,
      content: m.content,
      ...(m.toolCalls
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
        : {}),
    }));

    const ollamaTools =
      tools.length > 0
        ? tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        tools: ollamaTools,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama chat request failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const message = data.message;

    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = message.tool_calls.map((tc, i) => ({
        id: `ollama-tool-${Date.now()}-${i}`,
        name: tc.function.name,
        arguments: tc.function.arguments ?? {},
      }));
      return { toolCalls };
    }

    return { content: message?.content ?? "" };
  }

  async embed(text: string): Promise<number[]> {
    return this.embedInternal(text, /* allowPullRetry */ true);
  }

  private async embedInternal(text: string, allowPullRetry: boolean): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      const notFound = res.status === 404 && /not found/i.test(bodyText);

      if (notFound && allowPullRetry) {
        if (!this.isLocalBaseUrl()) {
          throw new Error(
            `Ollama embedding model "${this.embeddingModel}" is not available at ${this.baseUrl}. ` +
              `This baseUrl is not local, so it can't be auto-pulled from here -- ` +
              `run \`ollama pull ${this.embeddingModel}\` on that host.`
          );
        }

        await this.pullModel(this.embeddingModel);
        // Retry exactly once after a successful pull.
        return this.embedInternal(text, /* allowPullRetry */ false);
      }

      throw new Error(`Ollama embeddings request failed: ${res.status} ${bodyText}`);
    }

    const data = (await res.json()) as OllamaEmbeddingsResponse;
    return data.embedding;
  }

  private isLocalBaseUrl(): boolean {
    try {
      const hostname = new URL(this.baseUrl).hostname;
      return LOCAL_HOSTNAMES.has(hostname);
    } catch {
      return false;
    }
  }

  private async pullModel(model: string): Promise<void> {
    try {
      await pullOllamaModel(model, this.baseUrl);
    } catch (err) {
      throw new Error(
        `Failed to auto-pull Ollama embedding model "${model}": ${
          err instanceof Error ? err.message : String(err)
        }. Run \`ollama pull ${model}\` manually, or set it from the Providers screen.`
      );
    }
  }
}
