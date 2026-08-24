-- Adds Contact.jid: the full WhatsApp JID a contact last messaged from
-- (not just the bare digit "phone" -- see the field's doc comment in
-- schema.prisma for why reconstructing a JID from digits alone is unsafe).
-- Nullable: existing contacts backfill it automatically the next time they
-- send an inbound message (src/agent/orchestrator.ts's handleInbound
-- upserts it on every message), not via this migration.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "jid" TEXT;
