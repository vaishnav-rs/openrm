import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { EditorPane } from "../EditorPane.js";
import { TextInput } from "../TextInput.js";
import { colors, shellGeometry } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";
import { useClickRegions } from "../clickRegions.js";

const ESCALATION_PHONE_POLL_MS = 4000;

const DEFAULT_PROMPT =
  "You are the WhatsApp assistant for this business. Use your tools to remember " +
  "customer names and interests. Keep replies short and helpful.";

/**
 * Multi-line editor for AgentConfig.masterSystemPrompt (DB-backed singleton
 * row, id="1"). Combined with soul.md by the orchestrator to build the full
 * system prompt on every inbound message.
 *
 * Also hosts a small second field for AgentConfig.escalationPhone -- the
 * dedicated internal staff WhatsApp number notified by request_human_handoff
 * (see src/agent/tools/handoff.ts). It lives here rather than a dedicated
 * screen since it's a single AgentConfig field, same as masterSystemPrompt.
 */
const EDITOR_HEIGHT = 16;

export function SystemPrompt({
  active,
  onActivate,
}: {
  active: boolean;
  onActivate?: () => void;
}): React.ReactElement {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [escalationPhone, setEscalationPhone] = useState("");
  const [savedEscalationPhone, setSavedEscalationPhone] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState<"editor" | "phone">("editor");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const prisma = getPrisma();
      const row = await prisma.agentConfig.findUnique({ where: { id: "1" } });
      if (!cancelled) {
        const initial = row?.masterSystemPrompt ?? DEFAULT_PROMPT;
        setContent(initial);
        setSavedContent(initial);
        const phone = row?.escalationPhone ?? "";
        setEscalationPhone(phone);
        setSavedEscalationPhone(phone);
        setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-refresh only the escalation phone display -- never the draft
  // system-prompt text, which must only ever reflect what the user is
  // actively typing. Skipped whenever the phone field itself has unsaved
  // local edits, so a background poll never clobbers in-progress typing.
  useEffect(() => {
    const interval = setInterval(() => {
      if (escalationPhone !== savedEscalationPhone) return;
      void (async () => {
        const prisma = getPrisma();
        const row = await prisma.agentConfig.findUnique({ where: { id: "1" } });
        const phone = row?.escalationPhone ?? "";
        if (phone !== savedEscalationPhone) {
          setEscalationPhone(phone);
          setSavedEscalationPhone(phone);
        }
      })();
    }, scaledInterval(ESCALATION_PHONE_POLL_MS));
    return () => clearInterval(interval);
  }, [escalationPhone, savedEscalationPhone]);

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && (input === "s" || input === "S")) {
        void save();
        return;
      }
      if (key.tab) {
        setFocus((f) => (f === "editor" ? "phone" : "editor"));
      }
    },
    { isActive: active }
  );

  // Click regions ----------------------------------------------------------
  //
  // Two clickable targets, each just moving `focus` (and the app's
  // nav->screen focus via onActivate) the same way Tab already does: the
  // editor block, and the escalation-phone field below it. Row math mirrors
  // EditorPane's render structure (title, subtitle, marginTop blank, then a
  // bordered box of `height` content rows) followed by this screen's own
  // phone-field Box.
  const editorBottomRow = shellGeometry.screenTopRow + 2 /* subtitle + blank */ + 1 /* border top */ + EDITOR_HEIGHT;
  const phoneFieldRow = editorBottomRow + 3; // blank + border top + this content row
  useClickRegions(
    [
      {
        rowStart: shellGeometry.screenTopRow,
        rowEnd: editorBottomRow,
        colStart: shellGeometry.screenLeftCol,
        colEnd: 9999,
        onClick: () => {
          onActivate?.();
          setFocus("editor");
        },
      },
      {
        rowStart: phoneFieldRow,
        rowEnd: phoneFieldRow,
        colStart: shellGeometry.screenLeftCol,
        colEnd: 9999,
        onClick: () => {
          onActivate?.();
          setFocus("phone");
        },
      },
    ],
    true
  );

  async function save() {
    const prisma = getPrisma();
    await prisma.agentConfig.upsert({
      where: { id: "1" },
      update: { masterSystemPrompt: content, escalationPhone: escalationPhone || null },
      create: { id: "1", masterSystemPrompt: content, escalationPhone: escalationPhone || null },
    });
    setSavedContent(content);
    setSavedEscalationPhone(escalationPhone);
    setStatus(`saved at ${new Date().toLocaleTimeString()}`);
  }

  if (!loaded) return <Text dimColor>Loading...</Text>;

  return (
    <Box flexDirection="column">
      <EditorPane
        title="Master System Prompt"
        subtitle="Database-backed -- combined with soul.md on every reply"
        value={content}
        onChange={setContent}
        active={active && focus === "editor"}
        height={EDITOR_HEIGHT}
        dirty={content !== savedContent}
        status={status}
      />
      <Box marginTop={1} borderStyle="round" borderColor={focus === "phone" ? colors.borderFocus : colors.border} paddingX={1}>
        <Box width={22}>
          <Text color={focus === "phone" ? colors.accent : colors.textDim}>Escalation Phone:</Text>
        </Box>
        <TextInput
          value={escalationPhone}
          onChange={setEscalationPhone}
          active={active && focus === "phone"}
          placeholder="e.g. 15551234567 (staff number, no + or spaces)"
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Tab switch field · Ctrl+S save</Text>
      </Box>
    </Box>
  );
}
