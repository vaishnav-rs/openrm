import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getPrisma } from "../../db/prisma.js";
import { TextInput } from "../TextInput.js";
import { colors, icons } from "../theme.js";

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

export function McpServers({ active }: { active: boolean }): React.ReactElement {
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
  }

  useEffect(() => {
    void refresh();
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
      else if (input === "n") {
        setForm({ name: "", transportIdx: 0, command: "", args: "", url: "" });
        setFieldIndex(0);
        setMode("form");
      } else if (input === "e" && servers[selected]) {
        void toggleEnabled(servers[selected]);
      } else if (input === "d" && servers[selected]) {
        void remove(servers[selected].id);
      } else if (input === "t" && servers[selected]) {
        void test(servers[selected]);
      }
    },
    { isActive: active }
  );

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
        <Text dimColor>n new · e toggle enabled · d delete · t test connection</Text>
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
