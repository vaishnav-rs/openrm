import type {
  ChatMessage,
  ChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export interface OllamaProviderConfig {
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

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
    this.embeddingModel = config.embeddingModel ?? config.model;
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
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embeddings request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaEmbeddingsResponse;
    return data.embedding;
  }
}
