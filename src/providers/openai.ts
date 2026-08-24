import OpenAI from "openai";
import type {
  ChatMessage,
  ChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

/**
 * OpenAI provider via the official `openai` package's chat.completions API
 * with function/tool calling.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name: string = "openai";
  private client: OpenAI;
  private model: string;
  private embeddingModel: string;

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
    this.embeddingModel = config.embeddingModel ?? "text-embedding-3-small";
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResult> {
    const oaMessages = messages.map((m) => toOpenAIMessage(m));
    const oaTools =
      tools.length > 0
        ? tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: oaMessages,
      tools: oaTools,
    });

    const choice = response.choices[0];
    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJson(tc.function.arguments),
      }));
      return { toolCalls };
    }

    return { content: message.content ?? "" };
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function toOpenAIMessage(m: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId ?? "",
      content: m.content,
    };
  }
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls?.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }
  if (m.role === "system") {
    return { role: "system", content: m.content };
  }
  return { role: "user", content: m.content };
}
