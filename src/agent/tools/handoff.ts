import { getPrisma } from "../../db/prisma.js";
import { eventBus } from "../../tui/events.js";
import { notifyStaffOfEscalation } from "../../whatsapp/handlers.js";
import type { AgentTool } from "../tool-types.js";

/**
 * request_human_handoff -- the sole trigger for the human-handoff feature.
 *
 * This module imports from src/whatsapp/handlers.ts (for
 * notifyStaffOfEscalation), and handlers.ts imports handleInbound from
 * src/agent/orchestrator.ts, which in turn imports handoffTools from this
 * file -- a circular module graph. This is safe in ESM/Node: every
 * function crossing the cycle (handleInbound, notifyStaffOfEscalation) is a
 * top-level `function` declaration, which is hoisted and fully initialized
 * for the whole module graph during the linking phase, before any module's
 * body evaluates -- so these bindings are always resolvable by the time
 * they're actually called (well after all modules finish loading). Only
 * plain `const`/`let` exports would be unsafe to use across a cycle like
 * this.
 */
const requestHumanHandoff: AgentTool = {
  definition: {
    name: "request_human_handoff",
    description:
      "Flag this conversation for a human staff member to take over on their own " +
      "WhatsApp, and (if configured) alert them immediately. Only call this if the " +
      "customer EXPLICITLY asks to speak to a real person/human/agent, or if you have " +
      "genuinely exhausted your ability to help and there is no other option. NEVER " +
      "proactively suggest or mention this to the customer, and never call it just " +
      "because a question is hard -- only use it when they ask, or as an absolute " +
      "last resort.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Short explanation for staff: why the customer needs a human " +
            "(e.g. 'asked to speak to a person', 'complaint about a damaged order').",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  async execute(args, ctx) {
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (!reason) return "request_human_handoff requires a non-empty 'reason'.";

    const prisma = getPrisma();

    const contact = await prisma.contact.findUnique({ where: { phone: ctx.phone } });
    const conversation = contact
      ? await prisma.conversation.findFirst({
          where: { contactId: contact.id },
          orderBy: { createdAt: "desc" },
        })
      : null;

    if (!conversation) {
      // Shouldn't happen in practice (handleInbound always creates the
      // conversation before running the tool loop), but never crash the
      // reply over it.
      return "Could not find the current conversation to flag -- no conversation exists yet.";
    }

    const now = new Date();
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsHuman: true, escalatedAt: now },
    });

    eventBus.emitTyped("conversation:escalated", {
      conversationId: conversation.id,
      phone: ctx.phone,
      at: now.toISOString(),
    });

    const config = await prisma.agentConfig.findUnique({ where: { id: "1" } });
    const escalationPhone = config?.escalationPhone?.trim();

    if (!escalationPhone) {
      return (
        "Conversation flagged for human follow-up (visible on the dashboard). " +
        "No escalation phone number is configured, so no WhatsApp alert was sent -- " +
        "configure AgentConfig.escalationPhone from the System Prompt screen to enable that."
      );
    }

    const result = await notifyStaffOfEscalation({
      escalationPhone,
      customerPhone: ctx.phone,
      customerName: contact?.name,
      reason,
    });

    if (result.sent) {
      return "Conversation flagged for human follow-up and staff has been notified on WhatsApp.";
    }
    return `Conversation flagged for human follow-up, but the staff WhatsApp alert failed to send (${
      result.error ?? "unknown error"
    }).`;
  },
};

export const handoffTools: AgentTool[] = [requestHumanHandoff];
