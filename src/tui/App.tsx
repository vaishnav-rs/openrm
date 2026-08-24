import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Dashboard } from "./screens/Dashboard.js";
import { Pairing } from "./screens/Pairing.js";
import { ConversationsFeed } from "./screens/ConversationsFeed.js";
import { Contacts } from "./screens/Contacts.js";
import { Providers } from "./screens/Providers.js";
import { Soul } from "./screens/Soul.js";
import { SystemPrompt } from "./screens/SystemPrompt.js";
import { RagDocuments } from "./screens/RagDocuments.js";
import { McpServers } from "./screens/McpServers.js";
import { eventBus, type WaStatus } from "./events.js";
import { colors, icons, layout, waStatusColor, waStatusLabel } from "./theme.js";
import { getPrisma } from "../db/prisma.js";
import { scaledInterval } from "./terminal-env.js";

interface NavItem {
  key: string;
  label: string;
  icon: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "MONITOR",
    items: [
      { key: "dashboard", label: "Dashboard", icon: icons.diamond },
      { key: "pairing", label: "Pairing", icon: icons.qr },
      { key: "conversations", label: "Conversations", icon: icons.msg },
    ],
  },
  {
    title: "DATA",
    items: [{ key: "contacts", label: "Contacts", icon: icons.contact }],
  },
  {
    title: "CONFIGURE",
    items: [
      { key: "providers", label: "Providers", icon: icons.plug },
      { key: "soul", label: "Soul", icon: icons.edit },
      { key: "system-prompt", label: "System Prompt", icon: icons.gear },
    ],
  },
  {
    title: "KNOWLEDGE",
    items: [
      { key: "rag", label: "RAG Documents", icon: icons.book },
      { key: "mcp", label: "MCP Servers", icon: icons.server },
    ],
  },
];

const FLAT_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
type ScreenKey = string;

// --- Mouse support (nav column only) ---------------------------------
//
// SGR extended mouse mode: enabling it makes the terminal emit
// `ESC [ < Cb ; Cx ; Cy M` on button press and `...m` on release, with
// 1-based Cx/Cy terminal columns/rows. We only ever enable this while the
// left nav column has focus, and explicitly disable it the instant focus
// moves to the screen pane (see the effect below), on unmount, and on
// process exit -- so raw mouse bytes can never leak into a TextInput /
// TextArea field on another screen.
export const MOUSE_ENABLE_SEQUENCE = "\x1b[?1000h\x1b[?1006h";
export const MOUSE_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1006l";

const SGR_MOUSE_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

// Fixed row geometry of the chrome above the nav content:
//   - status bar Box (borderStyle="round", single content row): 3 rows
//   - nav Box's own top border: 1 row
// so the first line of nav content (the first group's title) lands on
// row STATUS_BAR_ROWS + NAV_TOP_BORDER_ROWS + 1.
const STATUS_BAR_ROWS = 3;
const NAV_TOP_BORDER_ROWS = 1;

/**
 * Mirrors the nav render loop's exact structure (group title line, then one
 * line per item, then the group's marginBottom gap) to compute the absolute
 * terminal row each nav item lands on. NAV_GROUPS is static, so this is
 * computed once at module load rather than re-derived every render.
 */
function computeNavRowMap(): Map<string, number> {
  const map = new Map<string, number>();
  let row = STATUS_BAR_ROWS + NAV_TOP_BORDER_ROWS + 1;
  for (const group of NAV_GROUPS) {
    row += 1; // group title line
    for (const item of group.items) {
      map.set(item.key, row);
      row += 1;
    }
    row += 1; // marginBottom gap after the group
  }
  return map;
}

const NAV_ROW_MAP = computeNavRowMap();

interface ProviderInfo {
  name: string;
  model: string;
}

// --- Isolated header leaf components -----------------------------------
//
// Each of these owns its own timer and its own local state, instead of
// living in App's top-level state (which is how an earlier version worked).
// That mattered for the flicker: when timer-driven state lived in App
// itself, every clock tick / pulse blink / stats poll re-rendered the
// *entire* App function component -- nav column, the whole active screen,
// everything -- even though only a few characters in the header actually
// changed. React only re-renders a component (and its subtree) when *its
// own* state changes, not its parent's, so isolating each ticking value
// into its own leaf component means a clock tick now only re-renders the
// Clock component, not the nav or whatever screen (Contacts table, RAG
// document list, an open editor, ...) happens to be open. This is
// independent of, and in addition to, the earlier fix for Ink's
// full-clear-vs-incremental-diff repaint path -- fewer/smaller re-renders
// means less work even on the cheap incremental path, which matters a lot
// on slower hosts (see terminal-env.ts).

function Clock(): React.ReactElement {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), scaledInterval(1000));
    return () => clearInterval(id);
  }, []);
  return <Text color={colors.muted}>{now.toLocaleTimeString()}</Text>;
}

function PulseDot({ waStatus }: { waStatus: WaStatus }): React.ReactElement {
  const blinking = waStatus === "connecting" || waStatus === "qr";
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!blinking) return;
    const id = setInterval(() => setOn((v) => !v), scaledInterval(500));
    return () => clearInterval(id);
  }, [blinking]);
  const statusDotColor = waStatusColor[waStatus] ?? colors.muted;
  const showDot = blinking ? on : true;
  return <Text color={showDot ? statusDotColor : colors.mutedDim}>{icons.dotFilled}</Text>;
}

function StatsBar(): React.ReactElement {
  const [contactCount, setContactCount] = useState<number | undefined>(undefined);
  const [messagesToday, setMessagesToday] = useState<number | undefined>(undefined);
  const [provider, setProvider] = useState<ProviderInfo | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const prisma = getPrisma();
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [contacts, messages, activeProvider] = await Promise.all([
          prisma.contact.count(),
          prisma.message.count({ where: { createdAt: { gte: startOfDay } } }),
          prisma.providerConfig.findFirst({ where: { isActive: true } }),
        ]);
        if (!cancelled) {
          setContactCount(contacts);
          setMessagesToday(messages);
          setProvider(activeProvider ? { name: activeProvider.name, model: activeProvider.model } : undefined);
        }
      } catch {
        // DB may not be reachable yet.
      }
    }
    void load();
    const id = setInterval(load, scaledInterval(4000));
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={colors.textDim}>
        {icons.gear} {provider ? `${provider.name}:${provider.model}` : "no provider"}
      </Text>
      <Text dimColor>│</Text>
      <Text color={colors.textDim}>
        {icons.contact} {contactCount ?? "…"}
      </Text>
      <Text color={colors.textDim}>
        {icons.msg} {messagesToday ?? "…"} today
      </Text>
    </Box>
  );
}

export function App(): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focus, setFocus] = useState<"nav" | "screen">("nav");
  const [waStatus, setWaStatus] = useState<WaStatus>("idle");
  const active: ScreenKey = FLAT_ITEMS[selectedIndex].key;

  useEffect(() => {
    const onStatus = ({ status }: { status: WaStatus }) => setWaStatus(status);
    eventBus.onTyped("wa:status", onStatus);
    return () => {
      eventBus.offTyped("wa:status", onStatus);
    };
  }, []);

  useInput((input, key) => {
    if (focus === "nav") {
      if (key.upArrow) {
        setSelectedIndex((i) => (i - 1 + FLAT_ITEMS.length) % FLAT_ITEMS.length);
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i + 1) % FLAT_ITEMS.length);
      } else if (key.return || key.rightArrow) {
        setFocus("screen");
      }
    } else {
      if (key.escape || (input === "q" && key.shift === false)) {
        setFocus("nav");
      } else if (key.leftArrow) {
        setFocus("nav");
      }
    }
  });

  // Enable SGR mouse click reporting only while the nav column has focus,
  // and explicitly disable it the instant focus leaves nav (dep change) or
  // this component unmounts (cleanup). This is what structurally prevents
  // raw mouse bytes from ever reaching a TextInput/TextArea on another
  // screen -- mouse mode is simply never on while focus === "screen".
  useEffect(() => {
    if (focus !== "nav") return;
    process.stdout.write(MOUSE_ENABLE_SEQUENCE);
    return () => {
      process.stdout.write(MOUSE_DISABLE_SEQUENCE);
    };
  }, [focus]);

  // Parse SGR mouse press sequences directly off stdin. This listener is
  // additive -- Ink's own useInput/useStdin machinery consumes a separate
  // internal "input" event derived from parse-keypress, which does not
  // recognize `ESC [ < ... M` sequences, so they pass through inertly to
  // any other "data" listener (verified by reading Ink's use-input.js /
  // StdinContext.js source: it listens on stdin via its own internal
  // EventEmitter, not by exclusively consuming raw "data" events).
  useEffect(() => {
    if (focus !== "nav") return;
    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const match = SGR_MOUSE_PATTERN.exec(str);
      if (!match) return;
      const [, buttonRaw, xRaw, yRaw, kind] = match;
      if (kind !== "M") return; // only presses, ignore releases
      const button = Number(buttonRaw);
      if (button !== 0) return; // left click only
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (x < 1 || x > layout.navWidth) return; // outside nav column
      for (const [key, row] of NAV_ROW_MAP) {
        if (row !== y) continue;
        const idx = FLAT_ITEMS.findIndex((item) => item.key === key);
        if (idx >= 0) {
          setSelectedIndex(idx);
          setFocus("screen");
        }
        return;
      }
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.removeListener("data", onData);
    };
  }, [focus]);

  // Belt-and-suspenders: also disable mouse mode on raw process exit (e.g.
  // an uncaught exception unwinding without React ever unmounting). SIGINT
  // is handled explicitly in src/cli/index.ts's handler.
  useEffect(() => {
    const onExit = () => {
      process.stdout.write(MOUSE_DISABLE_SEQUENCE);
    };
    process.on("exit", onExit);
    return () => {
      process.removeListener("exit", onExit);
    };
  }, []);

  // Ink's own render loop (see node_modules/ink/build/ink.js#onRender) takes
  // a disruptive "clear the whole terminal and repaint from scratch" path
  // whenever `outputHeight >= stdout.rows`, where outputHeight is the
  // computed height of what WE render (i.e. this root Box's height). If we
  // size the root to the terminal's *exact* row count, our own outputHeight
  // is essentially always >= stdout.rows, so Ink takes the clear-and-repaint
  // path on nearly every single render (instead of its normal smooth
  // incremental diff/overwrite) -- this is what actually caused the
  // flicker: not content overflowing a box, but us never leaving Ink any
  // headroom to tell our frame apart from "the whole terminal". Reserving
  // one row keeps outputHeight strictly below stdout.rows so Ink stays on
  // the cheap incremental-update path.
  //
  // useStdout() (rather than reading process.stdout.rows inline) ties this
  // to Ink's own resize plumbing -- it exposes the same live stdout object
  // Ink itself listens to for 'resize' -- which is the more correct/idiomatic
  // source here even though, functionally, Ink already forces a full
  // re-render on resize regardless of which API reads .rows.
  const { stdout } = useStdout();
  const rows = Math.max(1, (stdout.rows ?? 32) - 1);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Top status bar */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        paddingX={1}
        borderStyle="round"
        borderColor={colors.border}
        flexShrink={0}
      >
        <Box flexDirection="row" gap={1}>
          <Text bold color={colors.accent}>
            {icons.bolt} {icons.wordmark}
          </Text>
          <Text dimColor>│</Text>
          <PulseDot waStatus={waStatus} />
          <Text color={colors.textDim}>{waStatusLabel[waStatus] ?? waStatus}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <StatsBar />
          <Text dimColor>│</Text>
          <Clock />
        </Box>
      </Box>

      {/* Body: nav + screen */}
      <Box flexDirection="row" flexGrow={1}>
        <Box
          flexDirection="column"
          width={layout.navWidth}
          borderStyle="round"
          borderColor={focus === "nav" ? colors.borderFocus : colors.border}
          paddingX={1}
          flexShrink={0}
          overflow="hidden"
        >
          {NAV_GROUPS.map((group) => (
            <Box key={group.title} flexDirection="column" marginBottom={1}>
              <Text color={colors.mutedDim}>{group.title}</Text>
              {group.items.map((item) => {
                const globalIndex = FLAT_ITEMS.indexOf(item);
                const isSelected = globalIndex === selectedIndex;
                const bar = isSelected ? (focus === "nav" ? icons.arrowRight : icons.chevron) : " ";
                const labelColor = isSelected
                  ? focus === "nav"
                    ? colors.accent
                    : colors.text
                  : colors.textDim;
                return (
                  <Text key={item.key} bold={isSelected} color={labelColor}>
                    {bar} {item.icon} {item.label}
                  </Text>
                );
              })}
            </Box>
          ))}
        </Box>

        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={focus === "screen" ? colors.borderFocus : colors.border}
          paddingX={2}
          paddingY={1}
          overflow="hidden"
        >
          <ActiveScreen screen={active} active={focus === "screen"} />
        </Box>
      </Box>

      {/* Bottom help bar */}
      <Box paddingX={1} justifyContent="space-between" flexShrink={0}>
        <Text color={colors.mutedDim}>
          {focus === "nav"
            ? `${icons.caretUp}${icons.caretDown} navigate  ↵/→ open pane · click to open`
            : "esc/q/← back to nav  (see pane for keys)"}
        </Text>
        <Text color={colors.mutedDim}>
          openrm never initiates WhatsApp messages -- reactive only
        </Text>
      </Box>
    </Box>
  );
}

function ActiveScreen({
  screen,
  active,
}: {
  screen: ScreenKey;
  active: boolean;
}): React.ReactElement {
  switch (screen) {
    case "dashboard":
      return <Dashboard />;
    case "pairing":
      return <Pairing />;
    case "conversations":
      return <ConversationsFeed />;
    case "contacts":
      return <Contacts active={active} />;
    case "providers":
      return <Providers active={active} />;
    case "soul":
      return <Soul active={active} />;
    case "system-prompt":
      return <SystemPrompt active={active} />;
    case "rag":
      return <RagDocuments active={active} />;
    case "mcp":
      return <McpServers active={active} />;
    default:
      return <Text>Unknown screen</Text>;
  }
}
