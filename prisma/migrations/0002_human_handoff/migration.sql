-- openrm human handoff (Feature 2)
-- Adds "needs human" flagging to Conversation and a configurable dedicated
-- staff WhatsApp number to the AgentConfig singleton row. Note: Contact's
-- existing cascade relations to Interest/Conversation (and Conversation's
-- cascade to Message), established in 0001_init, already make
-- `prisma.contact.delete()` cascade cleanly -- no schema change is needed
-- for contact deletion (Feature 5).

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "needsHuman" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN "escalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentConfig" ADD COLUMN "escalationPhone" TEXT;
