import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { colors, icons, padCol, shellGeometry } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";
import { formatPhone } from "../phone.js";
import { labelRegion, listRowRegions, useClickRegions, type ClickRegion } from "../clickRegions.js";

const CONTACTS_POLL_MS = 4000;

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  updatedAt: Date;
  interests: { label: string; notes: string | null }[];
}

interface ConversationDetail {
  messages: { role: string; content: string; createdAt: Date }[];
}

const COL = { name: 20, phone: 20, interests: 10, lastSeen: 16 };

export function Contacts({
  active,
  onActivate,
}: {
  active: boolean;
  onActivate?: () => void;
}): React.ReactElement {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [drilledIn, setDrilledIn] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "confirm-delete">("list");

  async function refresh() {
    const prisma = getPrisma();
    const rows = await prisma.contact.findMany({
      include: { interests: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    setContacts(rows);
    // Keep the cursor in range if the list shrank/reordered under it rather
    // than resetting to the top on every background refresh.
    setSelected((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await refresh();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-refresh: newly-created contacts (from live inbound messages) show
  // up here without navigating away and back. refresh() clamps `selected`
  // rather than resetting it, so browsing isn't jarring.
  useEffect(() => {
    const interval = setInterval(() => void refresh(), scaledInterval(CONTACTS_POLL_MS));
    return () => clearInterval(interval);
  }, []);

  // Shared handlers -- called identically from the keyboard (useInput below)
  // and from click regions (useClickRegions further down), so there is one
  // code path per action rather than duplicated keyboard/mouse logic.
  function requestDelete() {
    if (contacts[selected]) setMode("confirm-delete");
  }

  function confirmDelete() {
    if (!contacts[selected]) return;
    void (async () => {
      const prisma = getPrisma();
      await prisma.contact.delete({ where: { id: contacts[selected].id } });
      setMode("list");
      await refresh();
    })();
  }

  function cancelDelete() {
    setMode("list");
  }

  function openDetails() {
    if (!contacts[selected]) return;
    void loadDetail(contacts[selected].id).then((d) => {
      setDetail(d);
      setDrilledIn(true);
    });
  }

  useInput(
    (input, key) => {
      if (!active) return;
      if (drilledIn) {
        if (key.escape || input === "b") setDrilledIn(false);
        return;
      }
      if (mode === "confirm-delete") {
        if (input === "y") confirmDelete();
        else cancelDelete();
        return;
      }
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(contacts.length - 1, i + 1));
      else if (key.return && contacts[selected]) {
        openDetails();
      } else if (input === "d" && contacts[selected]) {
        requestDelete();
      }
    },
    { isActive: active }
  );

  // Click regions ----------------------------------------------------------
  //
  // Row math mirrors the JSX below exactly, the same technique App.tsx's
  // nav column established (computeNavRowMap): title (screenTopRow), a
  // marginTop blank row, the column-header row, then one row per contact.
  const listStartRow = shellGeometry.screenTopRow + 3;
  const rowAfterList = listStartRow + contacts.length;
  const confirmContentRow = rowAfterList + 1; // marginTop blank + this row
  const footerContentRow = (mode === "confirm-delete" ? confirmContentRow + 2 : rowAfterList + 1);

  const confirmName = contacts[selected]?.name ?? contacts[selected]?.phone ?? "";
  const confirmLine = `Delete "${confirmName}" and all their interests/conversations? [y] Confirm  [esc] Cancel`;
  const footerLine = "↑/↓ select · ↵ view details · [d] Delete";

  const clickRegions: ClickRegion[] = [];
  if (mode === "list" && !drilledIn) {
    clickRegions.push(
      ...listRowRegions(listStartRow, shellGeometry.screenLeftCol, contacts.length, (i) => {
        setSelected(i);
        onActivate?.();
      })
    );
    const del = labelRegion(footerLine, footerContentRow, shellGeometry.screenLeftCol, "[d] Delete", () => {
      onActivate?.();
      requestDelete();
    });
    if (del) clickRegions.push(del);
  } else if (mode === "confirm-delete") {
    const yes = labelRegion(confirmLine, confirmContentRow, shellGeometry.screenLeftCol, "[y] Confirm", () => {
      onActivate?.();
      confirmDelete();
    });
    const no = labelRegion(confirmLine, confirmContentRow, shellGeometry.screenLeftCol, "[esc] Cancel", () => {
      onActivate?.();
      cancelDelete();
    });
    if (yes) clickRegions.push(yes);
    if (no) clickRegions.push(no);
  }
  useClickRegions(clickRegions, active);

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
        <Text bold color={colors.text}>
          {icons.contact} {contact.name ?? "(no name)"} <Text color={colors.textDim}>-- {formatPhone(contact.phone)}</Text>
        </Text>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1}>
          <Text color={colors.mutedDim}>INTERESTS</Text>
          {contact.interests.length === 0 && <Text dimColor>None logged.</Text>}
          {contact.interests.map((i, idx) => (
            <Text key={idx} color={colors.accentAlt}>
              {icons.bullet} {i.label}
              {i.notes ? <Text color={colors.textDim}> ({i.notes})</Text> : null}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1} flexGrow={1}>
          <Text color={colors.mutedDim}>RECENT CONVERSATION</Text>
          {(detail?.messages ?? []).length === 0 && <Text dimColor>No messages recorded.</Text>}
          {(detail?.messages ?? []).map((m, idx) => (
            <Text key={idx} color={m.role === "user" ? colors.info : colors.textDim}>
              {m.role === "user" ? icons.in : icons.out} [{m.role}] {m.content}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>esc/b back to list</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.contact} Contacts
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={colors.mutedDim}>
          {padCol("NAME", COL.name)} {padCol("PHONE", COL.phone)} {padCol("INTERESTS", COL.interests)} {padCol("LAST SEEN", COL.lastSeen)}
        </Text>
        {contacts.length === 0 && <Text dimColor>No contacts yet.</Text>}
        {contacts.map((c, i) => {
          const isSel = active && i === selected;
          return (
            <Text key={c.id} color={isSel ? colors.accent : colors.text} bold={isSel}>
              {isSel ? icons.arrowRight : " "} {padCol(c.name ?? "(no name)", COL.name)}{" "}
              {padCol(formatPhone(c.phone), COL.phone)} {padCol(String(c.interests.length), COL.interests)}{" "}
              {padCol(c.updatedAt.toLocaleDateString(), COL.lastSeen)}
            </Text>
          );
        })}
      </Box>
      {mode === "confirm-delete" && contacts[selected] && (
        <Box marginTop={1}>
          <Text color={colors.warning}>
            Delete "{confirmName}" and all their interests/conversations?{" "}
            <Text color={colors.success}>[y] Confirm</Text>
            {"  "}
            <Text color={colors.textDim}>[esc] Cancel</Text>
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {"↑/↓ select · ↵ view details · "}
          <Text color={colors.accent}>[d] Delete</Text>
        </Text>
      </Box>
    </Box>
  );
}
