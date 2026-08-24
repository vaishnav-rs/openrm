import { readFileSync } from "node:fs";
import { getPrisma } from "../db/prisma.js";
import { getActiveProvider } from "../providers/registry.js";
import type { ChatMessage, ToolDefinition } from "../providers/types.js";
import { getSoulPath } from "../setup/paths.js";
import { crmTools } from "./tools/crm.js";
import { ragTools } from "./tools/rag.js";
import { handoffTools } from "./tools/handoff.js";
import { loadMcpTools } from "./mcp-client.js";
import type { AgentTool, ToolContext } from "./tool-types.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 6;

/** Extracts the bare phone number from a WhatsApp JID like "15551234567@s.whatsapp.net". */
export function parsePhoneFromJid(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

function loadSoul(): string {
  try {
    return readFileSync(getSoulPath(), "utf-8");
  } catch {
    return "";
  }
}

async function loadMasterSystemPrompt(): Promise<string> {
  const prisma = getPrisma();
  const config = await prisma.agentConfig.findUnique({ where: { id: "1" } });
  return config?.masterSystemPrompt ?? "";
}

/**
 * Builds the always-present "GROUNDING POLICY" block that's appended to
 * every system prompt (see handleInbound below), instructing the model to
 * base ANY factual claim about the business on retrieve_knowledge results
 * rather than general model knowledge -- not just "what company is this"
 * but pricing, hours, policies, people, everything specific to this
 * business. This is fundamentally a prompt-engineering mitigation, not a
 * hard guarantee: tool calls can't be mechanically forced across every
 * provider/model this app supports (Ollama/OpenAI/Anthropic/OpenAI-compat
 * all differ in how strongly they honor "must call a tool"), so this raises
 * compliance but cannot guarantee it for 100% of replies. That's expected
 * and acceptable -- it's the best available lever short of provider-specific
 * forced tool-choice, which would break the provider-agnostic abstraction.
 *
 * Queried fresh (one cheap Document count) on every handleInbound call --
 * same "re-resolve per message" pattern already used for the active
 * provider -- so newly-ingested (or newly-emptied) knowledge bases are
 * reflected on the very next reply with no caching to invalidate.
 */
async function buildGroundingPolicy(): Promise<string> {
  const prisma = getPrisma();
  const documentCount = await prisma.document.count();

  if (documentCount === 0) {
    return (
      "GROUNDING POLICY: No knowledge base documents are loaded yet. If the " +
      "customer asks something specific to this business (products, services, " +
      "pricing, policies, hours, people, etc.), say plainly that you don't have " +
      "that information yet rather than guessing or inventing an answer."
    );
  }

  return (
    "GROUNDING POLICY: You MUST base ALL factual claims about this business -- " +
    "its products, services, pricing, policies, hours, people, or anything else " +
    "specific to this business -- on content retrieved via the retrieve_knowledge " +
    "tool, not on general knowledge or assumption. Call retrieve_knowledge before " +
    "answering any business-specific question you are not already certain of from " +
    "this conversation. If retrieve_knowledge returns nothing relevant, say you " +
    "don't have that information rather than guessing."
  );
}

async function getOrCreateConversation(contactId: string) {
  const prisma = getPrisma();
  const existing = await prisma.conversation.findFirst({
    where: { contactId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { contactId } });
}

/**
 * Handles one inbound message: resolves/creates the Contact + Conversation,
 * persists the user message, runs the provider's tool-calling loop against a
 * system prompt built fresh from soul.md + AgentConfig.masterSystemPrompt,
 * persists the assistant's final reply, and returns the reply text.
 *
 * This function never sends anything over WhatsApp itself -- it only
 * computes a reply. The caller (src/whatsapp/handlers.ts) is responsible for
 * actually calling sock.sendMessage with the returned text.
 *
 * Returns "" (and sends nothing further) when Conversation.humanControlled
 * is true -- see the check just below. The caller must treat an empty
 * string as "no bot reply was generated," not send it to WhatsApp, and not
 * emit a message:out event for it.
 */
export async function handleInbound(jid: string, text: string): Promise<string> {
  const prisma = getPrisma();
  const phone = parsePhoneFromJid(jid);

  const contact = await prisma.contact.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  const conversation = await getOrCreateConversation(contact.id);

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "user", content: text },
  });

  // A human staff member has taken manual control of this conversation from
  // the dashboard's "Jump In" (src/tui/screens/ConversationsFeed.tsx). The
  // inbound message is still persisted above so it appears live in the
  // dashboard thread, but the automatic tool-calling reply loop is skipped
  // entirely -- generating and sending a bot reply here would race with
  // whatever the human is about to type, which is exactly the collision
  // this switch exists to prevent. Control returns to the bot only via the
  // explicit "release to bot" action in that same screen.
  if (conversation.humanControlled) {
    return "";
  }

  const soul = loadSoul();
  const masterSystemPrompt = await loadMasterSystemPrompt();
  const groundingPolicy = await buildGroundingPolicy();
  const systemPrompt = [soul, masterSystemPrompt, groundingPolicy].filter(Boolean).join("\n\n");

  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
  });
  history.reverse();

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map(
      (m): ChatMessage => ({
        // "human" (a staff member's manual reply, see the "human" role doc
        // comment on Message.role in prisma/schema.prisma) presents to the
        // provider as an "assistant" turn: from the customer's perspective
        // both a bot reply and a staff reply are just "the business
        // replied", so the model should treat prior human replies as its
        // own prior turns, not react to them as some other party. The
        // dashboard/DB distinction between "human" and "assistant" is kept
        // everywhere else (this mapping only affects what's sent to
        // provider.chat()).
        role: m.role === "assistant" || m.role === "human" ? "assistant" : "user",
        content: m.content,
      })
    ),
  ];

  const mcpTools = await loadMcpTools();
  const allTools: AgentTool[] = [...crmTools, ...ragTools, ...handoffTools, ...mcpTools];
  const toolByName = new Map(allTools.map((t) => [t.definition.name, t]));
  const toolDefs: ToolDefinition[] = allTools.map((t) => t.definition);

  const provider = await getActiveProvider();
  const ctx: ToolContext = { phone, jid };

  let finalText = "";
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await provider.chat(messages, toolDefs);

    if (result.toolCalls && result.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: result.content ?? "",
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const tool = toolByName.get(call.name);
        let output: string;
        if (!tool) {
          output = `Unknown tool: ${call.name}`;
        } else {
          try {
            output = await tool.execute(call.arguments, ctx);
          } catch (err) {
            output = `Tool "${call.name}" failed: ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        messages.push({
          role: "tool",
          content: output,
          toolCallId: call.id,
          toolName: call.name,
        });
      }
      continue;
    }

    finalText = result.content ?? "";
    break;
  }

  if (!finalText) {
    finalText =
      "Sorry, I'm having trouble putting together a reply right now -- please try again in a moment.";
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "assistant", content: finalText },
  });

  return finalText;
}
