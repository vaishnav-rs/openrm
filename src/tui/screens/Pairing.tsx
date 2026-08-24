import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { eventBus, type WaStatus } from "../events.js";
import { renderQrToString } from "../qr.js";

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

  return (
    <Box flexDirection="column">
      <Text bold>Pairing</Text>
      <Box marginTop={1}>
        <Text>
          Status: <Text color={status === "connected" ? "green" : "yellow"}>{status}</Text>
        </Text>
      </Box>
      {detail && (
        <Box marginTop={1}>
          <Text dimColor>{detail}</Text>
        </Box>
      )}
      {status === "connected" && (
        <Box marginTop={1}>
          <Text color="green">WhatsApp is connected. This number is ready to receive messages.</Text>
        </Box>
      )}
      {qrString && status !== "connected" && (
        <Box marginTop={1} flexDirection="column">
          <Text>Scan this QR code with WhatsApp (Settings → Linked Devices):</Text>
          <Text>{qrString}</Text>
        </Box>
      )}
      {!qrString && status !== "connected" && status !== "idle" && (
        <Box marginTop={1}>
          <Text dimColor>Waiting for a QR code from WhatsApp...</Text>
        </Box>
      )}
    </Box>
  );
}
