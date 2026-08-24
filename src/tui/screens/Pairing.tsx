import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { eventBus, type WaStatus } from "../events.js";
import { renderQrToString } from "../qr.js";
import { colors, icons, waStatusColor, waStatusLabel } from "../theme.js";

export function Pairing(): React.ReactElement {
  const [status, setStatus] = useState<WaStatus>("idle");
  const [qrString, setQrString] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [spinFrame, setSpinFrame] = useState(0);

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

  useEffect(() => {
    if (status === "connected") return;
    const id = setInterval(() => setSpinFrame((f) => (f + 1) % icons.spinner.length), 90);
    return () => clearInterval(id);
  }, [status]);

  const stage: "waiting" | "connecting" | "scan" | "connected" =
    status === "connected"
      ? "connected"
      : qrString
        ? "scan"
        : status === "connecting"
          ? "connecting"
          : "waiting";

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

      <Box marginTop={1} flexDirection="column" alignItems="center" borderStyle="round" borderColor={stage === "connected" ? colors.success : colors.border} paddingX={2} paddingY={1}>
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
              <Text>{qrString}</Text>
            </Box>
            <Text dimColor>Waiting for scan...</Text>
          </Box>
        )}

        {stage === "connecting" && (
          <Box flexDirection="row" gap={1}>
            <Text color={colors.warning}>{icons.spinner[spinFrame]}</Text>
            <Text dimColor>Connecting to WhatsApp...</Text>
          </Box>
        )}

        {stage === "waiting" && (
          <Box flexDirection="row" gap={1}>
            <Text color={colors.muted}>{icons.spinner[spinFrame]}</Text>
            <Text dimColor>Waiting for a QR code from WhatsApp...</Text>
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
