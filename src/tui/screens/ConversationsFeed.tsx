import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { sendManualMessage } from "../../whatsapp/handlers.js";
import {
  eventBus,
  type MessageInEvent,
  type MessageOutEvent,
} from "../events.js";
import { colors, icons, padCol, shellGeometry } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";
import { formatPhone } from "../phone.js";
import { TextInput } from "../TextInput.js";
import { useClickRegions, type ClickRegion } from "../clickRegions.js";

const LIST_POLL_MS = 4000;
const THREAD_POLL_MS = 4000;
const THREAD_HISTORY_LIMIT = 100;
const VISIBLE_ROWS = 14;
const VISIBLE_MESSAGES = 14;
const NAME_WIDTH = 16;
const PREVIEW_WIDTH = 20;
const LEFT_PANE_WIDTH = 46;

interface ConversationRow {
  id: string;
  contactId: string;
  phone: string;
  // Contact's real, last-known WhatsApp JID -- see sendManualMessage's doc
  // comment in src/whatsapp/handlers.ts for why this must be preferred over
  // reconstructing a JID from `phone` digits for the manual compose send.
  jid: string | null;
  name: string | null;
  needsHuman: boolean;
  humanControlled: boolean;
  lastText: string;
  lastAt: Date;
}

interface ThreadEntry {
  role: string; // "user" | "assistant" | "human"
  text: string;
  at: string;
}

/**
 * One row per Conversation (not one row per Message like the old flat
 * feed), most-recently-active first. "Active" is derived from the newest
 * Message's createdAt (falling back to the conversation's own createdAt for
 * a brand new conversation with no messages yet) since Conversation itself
 * has no updatedAt column.
 */
async function loadConversationList(): Promise<ConversationRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.conversation.findMany({
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 100,
  });
  const mapped: ConversationRow[] = rows.map((r) => {
    const last = r.messages[0];
    return {
      id: r.id,
      contactId: r.contactId,
      phone: r.contact.phone,
      jid: r.contact.jid,
      name: r.contact.name,
      needsHuman: r.needsHuman,
      humanControlled: r.humanControlled,
      lastText: last?.content ?? "",
      lastAt: last?.createdAt ?? r.createdAt,
    };
  });
  mapped.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return mapped;
}

async function loadThread(conversationId: string): Promise<ThreadEntry[]> {
  const prisma = getPrisma();
  const messages = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant", "human"] } },
    orderBy: { createdAt: "asc" },
    take: THREAD_HISTORY_LIMIT,
  });
  return messages.map((m) => ({ role: m.role, text: m.content, at: m.createdAt.toISOString() }));
}

function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Top-level screen. Deliberately holds almost no state itself -- just which
 * sub-pane has keyboard focus (`subFocus`) and a lightweight summary of the
 * currently selected conversation (`selectedRow`, updated only when it
 * actually changes -- see ConversationList's diffed reporting below). The
 * two things that tick on their own timers (the conversation list's poll,
 * and the open thread's poll) are isolated into their own leaf components
 * (ConversationList, ThreadView) so a background refresh of either one
 * only re-renders that leaf, never this whole screen -- and, critically,
 * never touches ComposeBox's internal typing state, which lives entirely
 * inside ComposeBox itself and is never lifted up here.
 */
export function ConversationsFeed({
  active = true,
  onActivate,
}: {
  active?: boolean;
  onActivate?: () => void;
}): React.ReactElement {
  const [subFocus, setSubFocus] = useState<"list" | "compose">("list");
  const [selectedRow, setSelectedRow] = useState<ConversationRow | null>(null);

  const handleSelectionChange = useCallback((row: ConversationRow | null) => {
    setSelectedRow(row);
  }, []);

  // If the screen loses focus entirely (user tabs back to the nav column),
  // fall back to list sub-focus so re-entering the screen never leaves
  // compose silently "focused" with nothing able to see its own Esc key.
  useEffect(() => {
    if (!active) setSubFocus("list");
  }, [active]);

  const listKeyboardActive = active && subFocus === "list";
  const composeKeyboardActive = active && subFocus === "compose";

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={colors.text}>
        {icons.msg} Conversations
      </Text>
      <Box flexDirection="row" flexGrow={1} marginTop={1}>
        <ConversationList
          keyboardActive={listKeyboardActive}
          focused={subFocus === "list"}
          onSelectionChange={handleSelectionChange}
          onEnterCompose={() => setSubFocus("compose")}
          onActivate={onActivate}
        />
        <Box flexDirection="column" flexGrow={1} marginLeft={1}>
          {selectedRow ? (
            <>
              <Box flexDirection="column" marginBottom={1}>
                <Text bold color={colors.text}>
                  {icons.contact} {selectedRow.name ?? formatPhone(selectedRow.phone)}{" "}
                  <Text color={colors.textDim}>-- {formatPhone(selectedRow.phone)}</Text>
                </Text>
                <Box flexDirection="row" gap={2}>
                  <Text color={selectedRow.humanControlled ? colors.accentAlt : colors.success}>
                    {selectedRow.humanControlled
                      ? `${icons.human} Human active`
                      : `${icons.bot} Bot active`}
                  </Text>
                  {selectedRow.needsHuman && (
                    <Text color={colors.error} bold>
                      {icons.bolt} Needs human
                    </Text>
                  )}
                </Box>
              </Box>
              <ThreadView key={selectedRow.id} conversationId={selectedRow.id} phone={selectedRow.phone} />
              <ComposeBox
                active={composeKeyboardActive}
                conversationId={selectedRow.id}
                phone={selectedRow.phone}
                jid={selectedRow.jid}
                onEscape={() => setSubFocus("list")}
              />
            </>
          ) : (
            <Text dimColor>No conversations yet.</Text>
          )}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {subFocus === "list"
            ? "↑/↓ select · j jump in / release to bot · ↵ compose reply"
            : "typing reply -- ↵ send · esc back to list"}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Leaf component owning the conversation list's own poll timer and its own
 * selection index. Reports the currently selected row up to the parent via
 * onSelectionChange, but only when the fields the parent actually renders
 * (id/phone/name/needsHuman/humanControlled) have changed value -- not on
 * every poll tick where the selected row happens to come back identical.
 * That's what keeps a background list refresh from cascading into the
 * right pane re-rendering every LIST_POLL_MS.
 */
function ConversationList({
  keyboardActive,
  focused,
  onSelectionChange,
  onEnterCompose,
  onActivate,
}: {
  keyboardActive: boolean;
  focused: boolean;
  onSelectionChange: (row: ConversationRow | null) => void;
  onEnterCompose: () => void;
  onActivate?: () => void;
}): React.ReactElement {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastReportedKey = useRef<string>("");

  async function refresh() {
    const rows = await loadConversationList();
    setConversations(rows);
    setSelectedIndex((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), scaledInterval(LIST_POLL_MS));
    const onIn = () => void refresh();
    const onOut = () => void refresh();
    const onEscalated = () => void refresh();
    eventBus.onTyped("message:in", onIn);
    eventBus.onTyped("message:out", onOut);
    eventBus.onTyped("conversation:escalated", onEscalated);
    return () => {
      clearInterval(interval);
      eventBus.offTyped("message:in", onIn);
      eventBus.offTyped("message:out", onOut);
      eventBus.offTyped("conversation:escalated", onEscalated);
    };
  }, []);

  const selected = conversations[selectedIndex] ?? null;

  useEffect(() => {
    const key = selected
      ? `${selected.id}|${selected.phone}|${selected.name ?? ""}|${selected.needsHuman}|${selected.humanControlled}`
      : "";
    if (key !== lastReportedKey.current) {
      lastReportedKey.current = key;
      onSelectionChange(selected);
    }
  }, [selected, onSelectionChange]);

  async function toggleHumanControlled(row: ConversationRow) {
    const prisma = getPrisma();
    const next = !row.humanControlled;
    await prisma.conversation.update({ where: { id: row.id }, data: { humanControlled: next } });
    setConversations((prev) => prev.map((c) => (c.id === row.id ? { ...c, humanControlled: next } : c)));
  }

  useInput(
    (input, key) => {
      if (!keyboardActive) return;
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(conversations.length - 1, i + 1));
      else if (key.return) {
        if (selected) onEnterCompose();
      } else if (input === "j" && selected) {
        void toggleHumanControlled(selected);
      }
    },
    { isActive: keyboardActive }
  );

  const windowStart = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(VISIBLE_ROWS / 2), Math.max(0, conversations.length - VISIBLE_ROWS))
  );
  const visible = conversations.slice(windowStart, windowStart + VISIBLE_ROWS);

  // Click regions ----------------------------------------------------------
  //
  // Row math: title (screenTopRow), a marginTop=1 blank row, then this
  // list's own bordered box's top border -- so its first visible row lands
  // on screenTopRow + 3, one row per visible (windowed) conversation, same
  // as every other list screen in the app. Two regions per row: a narrow
  // one over just the humanControlled marker glyph (column offset 2, right
  // after the "arrow-or-space" selection indicator) that toggles jump-in
  // for THAT row directly -- registered first so it wins over the wider
  // row-select region underneath it -- and a wide one covering the rest of
  // the row that just selects it, matching Up/Down.
  const listStartRow = shellGeometry.screenTopRow + 3;
  const clickRegions: ClickRegion[] = [];
  visible.forEach((c, i) => {
    const globalIndex = windowStart + i;
    const row = listStartRow + i;
    clickRegions.push({
      rowStart: row,
      rowEnd: row,
      colStart: shellGeometry.screenLeftCol + 2,
      colEnd: shellGeometry.screenLeftCol + 2,
      onClick: () => {
        onActivate?.();
        setSelectedIndex(globalIndex);
        void toggleHumanControlled(c);
      },
    });
    clickRegions.push({
      rowStart: row,
      rowEnd: row,
      colStart: shellGeometry.screenLeftCol,
      colEnd: 9999,
      onClick: () => {
        onActivate?.();
        setSelectedIndex(globalIndex);
      },
    });
  });
  useClickRegions(clickRegions, true);

  return (
    <Box
      flexDirection="column"
      width={LEFT_PANE_WIDTH}
      borderStyle="round"
      borderColor={focused ? colors.borderFocus : colors.border}
      paddingX={1}
      flexShrink={0}
    >
      {conversations.length === 0 && <Text dimColor>No conversations yet.</Text>}
      {visible.map((c, i) => {
        const globalIndex = windowStart + i;
        const isSel = focused && globalIndex === selectedIndex;
        const label = c.name ?? formatPhone(c.phone);
        const preview = c.lastText.replace(/\s+/g, " ").trim();
        const rowColor = c.needsHuman ? colors.error : isSel ? colors.accent : colors.text;
        const marker = c.needsHuman ? icons.bolt : c.humanControlled ? icons.human : " ";
        return (
          <Text key={c.id} color={rowColor} bold={isSel || c.needsHuman}>
            {isSel ? icons.arrowRight : " "} {marker} {padCol(label, NAME_WIDTH)}{" "}
            <Text color={c.needsHuman ? colors.error : colors.textDim}>{padCol(preview, PREVIEW_WIDTH)}</Text>{" "}
            <Text color={colors.mutedDim}>{timeAgo(c.lastAt)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * Leaf component owning the open thread's own poll timer and message list.
 * Keyed by conversationId at the call site, so switching conversations
 * remounts it cleanly (fresh load, no stale carry-over from the previous
 * conversation). Refreshes on its own poll and on message:in/message:out
 * events, but only when the event's phone matches the conversation this
 * instance is showing -- so live messages on OTHER conversations never
 * cause this pane (or the compose box below it) to re-render.
 */
function ThreadView({ conversationId, phone }: { conversationId: string; phone: string }): React.ReactElement {
  const [entries, setEntries] = useState<ThreadEntry[]>([]);

  async function refresh() {
    const rows = await loadThread(conversationId);
    setEntries(rows);
  }

  useEffect(() => {
    void refresh();
  }, [conversationId]);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), scaledInterval(THREAD_POLL_MS));
    const onIn = (e: MessageInEvent) => {
      if (e.phone === phone) void refresh();
    };
    const onOut = (e: MessageOutEvent) => {
      if (e.phone === phone) void refresh();
    };
    eventBus.onTyped("message:in", onIn);
    eventBus.onTyped("message:out", onOut);
    return () => {
      clearInterval(interval);
      eventBus.offTyped("message:in", onIn);
      eventBus.offTyped("message:out", onOut);
    };
  }, [conversationId, phone]);

  const visible = entries.slice(-VISIBLE_MESSAGES);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.length === 0 && <Text dimColor>No messages yet.</Text>}
      {visible.map((e, i) => (
        <Box key={i} justifyContent={e.role === "user" ? "flex-start" : "flex-end"} marginTop={i === 0 ? 0 : 1}>
          <Bubble entry={e} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * A single message bubble. Rebuilt to fix a real overlap bug in the
 * previous version, which sized the bubble's `width` prop from
 * `entry.text.length + 4` -- raw character count as a proxy for rendered
 * width. That breaks for any multi-line message (embedded "\n" characters
 * count toward .length but contribute zero horizontal width) and produces
 * an incorrectly-shaped box that let the timestamp visually collide with
 * the message text.
 *
 * This version passes no `width` at all: the outer Box (column direction,
 * bordered) is sized entirely by Yoga/Ink from its actual children, the
 * same way every other bordered panel in this app already works. Each of
 * the three pieces of content -- sender label, message text, timestamp --
 * is its own separate <Text> child of that column Box, i.e. its own row.
 * Ink lays out column-direction children as stacked block-level rows, so
 * there is no shared row for wrapped message text and the timestamp to
 * collide in: the message Text's `wrap="wrap"` only wraps *within* that
 * Text's own row(s), and the timestamp always starts on the next row down,
 * however many lines the message wrapped to. (This is deliberately
 * different from the Soul editor's line-number gutter, which needs
 * `wrap="truncate-end"` to stay pixel-aligned against a fixed-width
 * per-line gutter column -- a chat bubble has no adjacent gutter to desync
 * against, so normal wrapping is what we actually want here.)
 */
function Bubble({ entry }: { entry: ThreadEntry }): React.ReactElement {
  const isOut = entry.role !== "user";
  const time = new Date(entry.at).toLocaleTimeString();
  const label = entry.role === "user" ? "customer" : entry.role === "human" ? "staff" : "openrm";
  const borderColor = !isOut ? colors.border : entry.role === "human" ? colors.accentAlt : colors.accent;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={isOut ? colors.accent : colors.textDim}>
        {isOut ? icons.out : icons.in} {label}
      </Text>
      <Text color={isOut ? colors.text : colors.textDim} wrap="wrap">
        {entry.text}
      </Text>
      <Text color={colors.mutedDim} dimColor>
        {time}
      </Text>
    </Box>
  );
}

/**
 * Leaf component owning the compose box's own local typing state (`text`).
 * That state lives here, not in ConversationsFeed, so background polling
 * elsewhere on this screen never touches (or resets) what the operator is
 * currently typing. `sendManualMessage` is the third and final
 * `sock.sendMessage` call site in the whole codebase (see the doc comment
 * on it in src/whatsapp/handlers.ts) -- it is only ever invoked from
 * handleSubmit below, itself only reachable via TextInput's onSubmit, which
 * Ink only fires in response to the operator physically pressing Enter
 * while this box is focused (`active` is only true when the screen has
 * focus AND the parent's subFocus === "compose", itself only reachable via
 * the operator pressing Enter on the list first). There is no code path
 * into this from any agent/tool logic.
 */
function ComposeBox({
  active,
  conversationId,
  phone,
  jid,
  onEscape,
}: {
  active: boolean;
  conversationId: string;
  phone: string;
  jid: string | null;
  onEscape: () => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Mirrors the mode="input" pattern in RagDocuments.tsx: TextInput itself
  // has no Escape handling, so a second, additive useInput hook alongside
  // it is this codebase's established way to catch Escape while a
  // TextInput is active.
  useInput(
    (_input, key) => {
      if (!active) return;
      if (key.escape) onEscape();
    },
    { isActive: active }
  );

  async function handleSubmit(value: string) {
    if (!value.trim() || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const result = await sendManualMessage({ conversationId, phone, jid, text: value });
      if (result.sent) {
        setText("");
        // sendManualMessage can report sent:true with an error attached --
        // the WhatsApp send itself succeeded but saving it to the dashboard
        // afterward failed. Still surface that, just don't treat it as a
        // failed send (the customer did receive it).
        if (result.error) setError(result.error);
      } else {
        setError(result.error ?? "Failed to send.");
      }
    } catch (err) {
      // Defensive: sendManualMessage is designed to never throw (it catches
      // internally and returns {sent, error}), but if it somehow does
      // anyway, this must still resolve to a visible error rather than
      // leaving `sending` stuck true forever with nothing on screen.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={active ? colors.borderFocus : colors.border}
      paddingX={1}
      flexShrink={0}
    >
      <Text color={colors.mutedDim}>Reply as staff -- ↵ send, esc back to list</Text>
      <TextInput
        value={text}
        onChange={setText}
        onSubmit={handleSubmit}
        active={active}
        placeholder="Type a message..."
      />
      {sending && (
        <Text color={colors.warning}>
          {icons.spinner[0]} Sending...
        </Text>
      )}
      {error && (
        <Text color={colors.error}>
          {icons.cross} {error}
        </Text>
      )}
    </Box>
  );
}
