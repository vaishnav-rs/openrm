import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { eventBus, type WaStatus } from "../events.js";
import { renderQrToString } from "../qr.js";
import { colors, icons, waStatusColor, waStatusLabel } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";

// Rows of chrome that are NOT the QR block itself, on this screen, given
// the current JSX below: title, status line (+ its marginTop), the margin
// before the bordered panel, the panel's own border + paddingY, the "Scan
// with..." line (+ its marginTop before the QR text), and the "Waiting for
// scan..." line. Kept in sync by hand with the JSX below -- if you change
// the structure of the "scan" stage block, update this.
const PAIRING_NON_QR_ROWS = 1 /* title */ + 2 /* status + its marginTop */ + 1 /* margin before panel */ +
  1 /* panel border top */ + 1 /* panel paddingY top */ + 1 /* "Scan with..." line */ +
  1 /* margin before QR text */ + 1 /* "Waiting for scan..." line */ + 1 /* panel paddingY bottom */ +
  1 /* panel border bottom */;

// Rows of chrome App.tsx wraps around every screen: status bar (3), help
// bar (1), and the content pane's own border + paddingY (4). Kept in sync
// by hand with src/tui/App.tsx's layout -- see STATUS_BAR_ROWS there.
const APP_CHROME_ROWS = 3 + 1 + 4;

// Isolated so its own interval-driven re-renders don't force the QR block /
// surrounding chrome to redraw on every tick too -- a spinner tick only
// needs to repaint this one glyph, not the whole screen. 150ms is a
// standard, still-smooth spinner cadence (vs. the previous 90ms, which was
// needlessly fast and, combined with the previous "redraw everything on
// every tick" structure, was the single most render-frequent screen in the
// app).
const SPINNER_INTERVAL_MS = 150;

function Spinner({ color }: { color: string }): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % icons.spinner.length), scaledInterval(SPINNER_INTERVAL_MS));
    return () => clearInterval(id);
  }, []);
  return <Text color={color}>{icons.spinner[frame]}</Text>;
}

export function Pairing(): React.ReactElement {
  const [status, setStatus] = useState<WaStatus>("idle");
  const [qrString, setQrString] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<string | undefined>(undefined);

  useEffect(() => {
    const onStatus = (e: { status: WaStatus; detail?: string }) => {
      setStatus(e.status);
      setDetail(e.detail);
      if (e.status === "connected") setQrString(undefined);
    };
    const onQr = ({ qr }: { qr: string }) => {
      void renderQrToString(qr).then(setQrString);
    };

    eventBus.onTyped("wa:status", onStatus);
    eventBus.onTyped("wa:qr", onQr);
    return () => {
      eventBus.offTyped("wa:status", onStatus);
      eventBus.offTyped("wa:qr", onQr);
    };
  }, []);

  // "logged_out" used to fall into the same generic "waiting" bucket as a
  // fresh, never-yet-connected session -- showing "Waiting for a QR code
  // from WhatsApp..." even though Baileys had already given up and will
  // NEVER generate a new QR on its own once a session is logged out (see
  // client.ts: it deliberately does not auto-reconnect in that specific
  // case, since a logged-out session's auth is dead and needs clearing).
  // That completely masked the real state. Give it its own "stalled" stage
  // with an explicit, actionable message instead.
  //
  // "disconnected" is different -- client.ts DOES auto-reconnect from that
  // state on its own, so it's transient by design, not a dead end; it's
  // handled by the "connecting" stage below alongside its `detail` text
  // ("Connection dropped, reconnecting...") rather than treated as stalled.
  const stage: "waiting" | "connecting" | "scan" | "connected" | "stalled" =
    status === "connected"
      ? "connected"
      : qrString
        ? "scan"
        : status === "connecting" || status === "disconnected"
          ? "connecting"
          : status === "logged_out"
            ? "stalled"
            : "waiting";

  // Guard against rendering a QR block taller than the guaranteed-visible
  // area: a clipped QR can look plausible but fails to decode (this
  // matches a real report -- WhatsApp shows "Logging in..." after a scan
  // but never completes, consistent with scanning a corrupted/truncated
  // payload). Rather than silently render a partial code, detect when it
  // won't fit and tell the user clearly instead.
  const terminalRows = process.stdout.rows ?? 32;
  const availableQrRows = terminalRows - APP_CHROME_ROWS - PAIRING_NON_QR_ROWS;
  const qrLineCount = qrString ? qrString.split("\n").length : 0;
  const qrFitsOnScreen = qrString ? qrLineCount <= availableQrRows : false;

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.qr} Pairing
      </Text>

      <Box marginTop={1}>
        <Text>
          Status: <Text color={waStatusColor[status]}>{icons.dotFilled} {waStatusLabel[status] ?? status}</Text>
        </Text>
      </Box>
      {detail && (
        <Box>
          <Text dimColor>{detail}</Text>
        </Box>
      )}

      <Box
        marginTop={1}
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor={stage === "connected" ? colors.success : stage === "stalled" ? colors.error : colors.border}
        paddingX={2}
        paddingY={1}
      >
        {stage === "connected" && (
          <Box flexDirection="column" alignItems="center">
            <Text color={colors.success} bold>
              {icons.check} WhatsApp is connected
            </Text>
            <Text dimColor>This number is ready to receive messages.</Text>
          </Box>
        )}

        {stage === "scan" && qrString && (
          <Box flexDirection="column" alignItems="center">
            <Text color={colors.warning}>Scan with WhatsApp → Settings → Linked Devices</Text>
            <Box marginTop={1}>
              {qrFitsOnScreen ? (
                <Text>{qrString}</Text>
              ) : (
                <Text color={colors.error}>
                  Terminal too small to show the QR code without clipping it (needs ~{qrLineCount}{" "}
                  rows, only ~{Math.max(availableQrRows, 0)} available). A clipped QR will not scan
                  correctly -- resize your terminal to at least{" "}
                  {qrLineCount + APP_CHROME_ROWS + PAIRING_NON_QR_ROWS} rows and reopen this screen.
                </Text>
              )}
            </Box>
            <Text dimColor>Waiting for scan...</Text>
          </Box>
        )}

        {stage === "connecting" && (
          <Box flexDirection="row" gap={1}>
            <Spinner color={colors.warning} />
            <Text dimColor>Connecting to WhatsApp...</Text>
          </Box>
        )}

        {stage === "waiting" && (
          <Box flexDirection="row" gap={1}>
            <Spinner color={colors.muted} />
            <Text dimColor>Waiting for a QR code from WhatsApp...</Text>
          </Box>
        )}

        {stage === "stalled" && (
          <Box flexDirection="column" alignItems="center">
            <Text color={colors.error} bold>
              {icons.cross} Session logged out
            </Text>
            <Text dimColor>
              This WhatsApp session was logged out and can't generate a new QR on its own.
            </Text>
            <Box marginTop={1}>
              <Text>
                Run <Text color={colors.accent}>openrm reset --yes</Text> then{" "}
                <Text color={colors.accent}>openrm init</Text> to start a fresh pairing.
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {icons.bullet} Open WhatsApp on your phone {icons.chevron} Settings {icons.chevron} Linked
          Devices {icons.chevron} Link a device, then scan the code above.
        </Text>
      </Box>
    </Box>
  );
}
