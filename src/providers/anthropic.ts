import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  ChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";
import { UnsupportedOperationError } from "./types.js";

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Anthropic provider via @anthropic-ai/sdk's messages.create with tool use.
 * Anthropic has no public embeddings API, so embed() throws a descriptive
 * error directing the user to configure a different provider's
 * embeddingModel for RAG.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResult> {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    const anthropicMessages: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        anthropicMessages.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const blocks: Array<
          Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam
        > = [];
        if (m.content) {
          blocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.toolCalls ?? []) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: "assistant", content: blocks });
      } else if (m.role === "tool") {
        anthropicMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId ?? "",
              content: m.content,
            },
          ],
        });
      }
    }

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    if (toolCalls.length > 0) {
      return { toolCalls };
    }
    return { content: text };
  }

  async embed(_text: string): Promise<number[]> {
    throw new UnsupportedOperationError(
      "Anthropic has no public embeddings API. Configure a different provider's " +
        "embeddingModel (e.g. an OpenAI or Ollama ProviderConfig row) to use RAG " +
        "features alongside Anthropic for chat."
    );
  }
}
