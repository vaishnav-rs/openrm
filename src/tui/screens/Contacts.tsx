import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  interests: { label: string; notes: string | null }[];
}

interface ConversationDetail {
  messages: { role: string; content: string; createdAt: Date }[];
}

export function Contacts({ active }: { active: boolean }): React.ReactElement {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [drilledIn, setDrilledIn] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const prisma = getPrisma();
        const rows = await prisma.contact.findMany({
          include: { interests: true },
          orderBy: { updatedAt: "desc" },
          take: 50,
        });
        if (!cancelled) setContacts(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;
      if (drilledIn) {
        if (key.escape || input === "b") setDrilledIn(false);
        return;
      }
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(contacts.length - 1, i + 1));
      else if (key.return && contacts[selected]) {
        void loadDetail(contacts[selected].id).then((d) => {
          setDetail(d);
          setDrilledIn(true);
        });
      }
    },
    { isActive: active }
  );

  async function loadDetail(contactId: string): Promise<ConversationDetail> {
    const prisma = getPrisma();
    const conversation = await prisma.conversation.findFirst({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
    });
    return { messages: conversation?.messages ?? [] };
  }

  if (loading) return <Text dimColor>Loading contacts...</Text>;

  if (drilledIn && contacts[selected]) {
    const contact = contacts[selected];
    return (
      <Box flexDirection="column">
        <Text bold>
          {contact.name ?? "(no name)"} -- {contact.phone}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Interests</Text>
          {contact.interests.length === 0 && <Text dimColor>None logged.</Text>}
          {contact.interests.map((i, idx) => (
            <Text key={idx}>
              - {i.label}
              {i.notes ? ` (${i.notes})` : ""}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Recent conversation</Text>
          {(detail?.messages ?? []).map((m, idx) => (
            <Text key={idx} dimColor={m.role !== "user"}>
              [{m.role}] {m.content}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc/b to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Contacts</Text>
      <Box marginTop={1} flexDirection="column">
        {contacts.length === 0 && <Text dimColor>No contacts yet.</Text>}
        {contacts.map((c, i) => (
          <Text key={c.id} color={active && i === selected ? "green" : undefined}>
            {active && i === selected ? "> " : "  "}
            {c.name ?? "(no name)"} -- {c.phone} ({c.interests.length} interests)
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ select, Enter to view details</Text>
      </Box>
    </Box>
  );
}
