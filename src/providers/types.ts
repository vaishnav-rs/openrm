/**
 * Provider-agnostic message/tool shapes. Every LLMProvider implementation
 * translates these to/from its native API's shape; the orchestrator's
 * tool-execution loop only ever deals with these normalized types.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  /** Plain text content. Empty string when a message is purely tool_calls. */
  content: string;
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: ToolCall[];
  /** Present on role:"tool" messages -- the id of the ToolCall being answered. */
  toolCallId?: string;
  /** Present on role:"tool" messages -- the name of the tool that was called. */
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema for the tool's arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatResult {
  /** Set when the model produced a final text reply (no further tool calls). */
  content?: string;
  /** Set when the model wants to call one or more tools. */
  toolCalls?: ToolCall[];
}

export class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}

export interface LLMProvider {
  /** Human-readable name, e.g. "openai", matching ProviderConfig.name. */
  readonly name: string;
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResult>;
  embed(text: string): Promise<number[]>;
}
