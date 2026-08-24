import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getPrisma } from "../../db/prisma.js";
import { TextInput } from "../TextInput.js";
import { colors, icons, shellGeometry } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";
import { labelRegion, useClickRegions, type ClickRegion } from "../clickRegions.js";

const MCP_POLL_MS = 4000;

interface McpRow {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
}

const TRANSPORTS = ["stdio", "http"] as const;
const FIELDS = ["name", "transport", "command", "args", "url"] as const;

export function McpServers({
  active,
  onActivate,
}: {
  active: boolean;
  onActivate?: () => void;
}): React.ReactElement {
  const [servers, setServers] = useState<McpRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [fieldIndex, setFieldIndex] = useState(0);
  const [form, setForm] = useState({
    name: "",
    transportIdx: 0,
    command: "",
    args: "",
    url: "",
  });
  const [testResult, setTestResult] = useState<string | undefined>(undefined);
  const [testOk, setTestOk] = useState<boolean | undefined>(undefined);
  const [testing, setTesting] = useState(false);

  async function refresh() {
    const prisma = getPrisma();
    const rows = await prisma.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
    setServers(rows);
    setSelected((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Live-refresh so servers added/toggled elsewhere show up without
  // navigating away and back.
  useEffect(() => {
    const interval = setInterval(() => void refresh(), scaledInterval(MCP_POLL_MS));
    return () => clearInterval(interval);
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;

      if (mode === "form") {
        if (key.tab) {
          setFieldIndex((i) => (i + 1) % FIELDS.length);
          return;
        }
        if (key.escape) {
          setMode("list");
          return;
        }
        const field = FIELDS[fieldIndex];
        if (field === "transport") {
          if (key.leftArrow || key.rightArrow) {
            setForm((f) => ({ ...f, transportIdx: (f.transportIdx + 1) % TRANSPORTS.length }));
          }
          if (key.return) setFieldIndex((i) => (i + 1) % FIELDS.length);
          return;
        }
        if (key.return && fieldIndex === FIELDS.length - 1) {
          void saveForm();
        }
        return;
      }

      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(servers.length - 1, i + 1));
      else if (input === "n") startNewServer();
      else if (input === "e") toggleSelectedEnabled();
      else if (input === "d") deleteSelected();
      else if (input === "t") testSelected();
    },
    { isActive: active }
  );

  // Shared handlers -- called identically from the keyboard above and from
  // click regions below, one code path per action.
  function startNewServer() {
    setForm({ name: "", transportIdx: 0, command: "", args: "", url: "" });
    setFieldIndex(0);
    setMode("form");
  }
  function toggleSelectedEnabled() {
    if (servers[selected]) void toggleEnabled(servers[selected]);
  }
  function deleteSelected() {
    if (servers[selected]) void remove(servers[selected].id);
  }
  function testSelected() {
    if (servers[selected]) void test(servers[selected]);
  }

  // Click regions ------------------------------------------------------
  //
  // Same "N boxes with a gap between them" shape as Providers.tsx: each
  // server box is 4 rows tall (border, name/status, transport line,
  // border), with 1 blank gap row between boxes.
  const listClickRegions: ClickRegion[] = [];
  const formClickRegions: ClickRegion[] = [];

  if (mode === "list") {
    const firstBoxTop = shellGeometry.screenTopRow + 1;
    for (let i = 0; i < servers.length; i++) {
      const boxTop = firstBoxTop + i * 5;
      listClickRegions.push({
        rowStart: boxTop,
        rowEnd: boxTop + 3,
        colStart: shellGeometry.screenLeftCol,
        colEnd: 9999,
        onClick: () => {
          setSelected(i);
          onActivate?.();
        },
      });
    }
    const listHeight = servers.length > 0 ? servers.length * 5 - 1 : 1;
    const rowAfterList = firstBoxTop + listHeight;
    const extraLines = testing || testResult ? 2 : 0;
    const footerRow = rowAfterList + extraLines + 1;
    const footerLine = "[n] New · [e] Toggle Enabled · [d] Delete · [t] Test";
    const buttons: [string, () => void][] = [
      ["[n] New", () => { onActivate?.(); startNewServer(); }],
      ["[e] Toggle Enabled", () => { onActivate?.(); toggleSelectedEnabled(); }],
      ["[d] Delete", () => { onActivate?.(); deleteSelected(); }],
      ["[t] Test", () => { onActivate?.(); testSelected(); }],
    ];
    for (const [label, onClick] of buttons) {
      const region = labelRegion(footerLine, footerRow, shellGeometry.screenLeftCol, label, onClick);
      if (region) listClickRegions.push(region);
    }
  } else {
    const fieldsStartRow = shellGeometry.screenTopRow + 1;
    for (let i = 0; i < FIELDS.length; i++) {
      const row = fieldsStartRow + i;
      formClickRegions.push({
        rowStart: row,
        rowEnd: row,
        colStart: shellGeometry.screenLeftCol,
        colEnd: 9999,
        onClick: () => {
          onActivate?.();
          setFieldIndex(i);
        },
      });
    }
  }

  useClickRegions(mode === "list" ? listClickRegions : formClickRegions, active);

  async function saveForm() {
    const prisma = getPrisma();
    await prisma.mcpServer.create({
      data: {
        name: form.name || "unnamed",
        transport: TRANSPORTS[form.transportIdx],
        command: form.command || null,
        args: form.args ? form.args.split(" ").filter(Boolean) : [],
        url: form.url || null,
        enabled: true,
      },
    });
    setMode("list");
    await refresh();
  }

  async function toggleEnabled(row: McpRow) {
    const prisma = getPrisma();
    await prisma.mcpServer.update({ where: { id: row.id }, data: { enabled: !row.enabled } });
    await refresh();
  }

  async function remove(id: string) {
    const prisma = getPrisma();
    await prisma.mcpServer.delete({ where: { id } });
    setSelected(0);
    await refresh();
  }

  async function test(row: McpRow) {
    setTesting(true);
    setTestResult(undefined);
    setTestOk(undefined);
    try {
      const client = new Client({ name: "openrm", version: "0.1.0" }, { capabilities: {} });
      if (row.transport === "stdio") {
        if (!row.command) throw new Error("No command configured");
        const transport = new StdioClientTransport({ command: row.command, args: row.args });
        await client.connect(transport);
      } else {
        if (!row.url) throw new Error("No url configured");
        const transport = new StreamableHTTPClientTransport(new URL(row.url));
        await client.connect(transport);
      }
      const { tools } = await client.listTools();
      setTestOk(true);
      setTestResult(`${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`);
    } catch (err) {
      setTestOk(false);
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  if (mode === "form") {
    return (
      <Box flexDirection="column">
        <Text bold color={colors.text}>
          {icons.server} New MCP Server
        </Text>
        <Field label="Name" active={fieldIndex === 0}>
          <TextInput value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} active={fieldIndex === 0} />
        </Field>
        <Field label="Transport (←/→)" active={fieldIndex === 1}>
          <Text color={colors.accent}>{TRANSPORTS[form.transportIdx]}</Text>
        </Field>
        <Field label="Command" active={fieldIndex === 2}>
          <TextInput
            value={form.command}
            onChange={(v) => setForm((f) => ({ ...f, command: v }))}
            active={fieldIndex === 2}
            placeholder="(stdio only) e.g. npx"
          />
        </Field>
        <Field label="Args (space sep)" active={fieldIndex === 3}>
          <TextInput
            value={form.args}
            onChange={(v) => setForm((f) => ({ ...f, args: v }))}
            active={fieldIndex === 3}
            placeholder="-y some-mcp-server"
          />
        </Field>
        <Field label="URL" active={fieldIndex === 4}>
          <TextInput
            value={form.url}
            onChange={(v) => setForm((f) => ({ ...f, url: v }))}
            active={fieldIndex === 4}
            placeholder="(http only) https://..."
          />
        </Field>
        <Box marginTop={1}>
          <Text dimColor>Tab move fields · ↵ on last field to save · Esc cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.server} MCP Servers
      </Text>
      <Box marginTop={1} flexDirection="column" gap={1}>
        {servers.length === 0 && <Text dimColor>No MCP servers configured. Press "n" to add one.</Text>}
        {servers.map((s, i) => {
          const isSel = active && i === selected;
          return (
            <Box
              key={s.id}
              flexDirection="column"
              borderStyle="round"
              borderColor={isSel ? colors.borderFocus : colors.border}
              paddingX={1}
            >
              <Box justifyContent="space-between">
                <Text bold={isSel} color={isSel ? colors.accent : colors.text}>
                  {isSel ? icons.arrowRight : " "} {s.name}
                </Text>
                <Text color={s.enabled ? colors.success : colors.mutedDim}>
                  {s.enabled ? `${icons.dotFilled} ENABLED` : `${icons.dotHollow} DISABLED`}
                </Text>
              </Box>
              <Text color={colors.textDim}>
                {s.transport === "stdio" ? "⌘ stdio" : "🌐 http"}
                {s.transport === "stdio" ? ` -- ${s.command ?? "(no command)"}` : ` -- ${s.url ?? "(no url)"}`}
              </Text>
            </Box>
          );
        })}
      </Box>
      {testing && (
        <Box marginTop={1}>
          <Text color={colors.warning}>{icons.spinner[0]} Testing connection...</Text>
        </Box>
      )}
      {testResult && !testing && (
        <Box marginTop={1}>
          <Text color={testOk ? colors.success : colors.error}>
            {testOk ? icons.check : icons.cross} {testResult}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={colors.accent}>[n] New</Text> · <Text color={colors.accent}>[e] Toggle Enabled</Text> ·{" "}
          <Text color={colors.accent}>[d] Delete</Text> · <Text color={colors.accent}>[t] Test</Text>
        </Text>
      </Box>
    </Box>
  );
}

function Field({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box>
      <Box width={20}>
        <Text color={active ? colors.accent : colors.textDim}>{label}:</Text>
      </Box>
      {children}
    </Box>
  );
}
