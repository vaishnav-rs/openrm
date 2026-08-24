-- openrm Conversations dashboard (per-conversation view, manual "Jump In",
-- and manual staff replies).
--
-- Adds Conversation.humanControlled, the switch that pauses the agent's
-- automatic reply loop for a conversation while a human is actively driving
-- it from the dashboard. This is deliberately separate from needsHuman
-- (Conversation.needsHuman is the agent's own automatic escalation signal
-- from request_human_handoff; humanControlled is "who is replying right
-- now"). See src/agent/orchestrator.ts's handleInbound and
-- src/tui/screens/ConversationsFeed.tsx for how it's read/written.
--
-- No change to Message.role's column type (still a plain TEXT column) is
-- needed to support the new "human" role value -- it was never a Postgres
-- enum, just an application-level convention documented in schema.prisma.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "humanControlled" BOOLEAN NOT NULL DEFAULT false;
