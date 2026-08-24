import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { instantiateProvider } from "../../providers/registry.js";
import { TextInput } from "../TextInput.js";
import { colors, icons } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";

const PROVIDERS_POLL_MS = 4000;

interface ProviderRow {
  id: string;
  name: string;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  embeddingModel: string | null;
  isActive: boolean;
}

const PROVIDER_NAMES = ["ollama", "openai", "anthropic", "openai-compatible"] as const;
const FIELDS = ["name", "apiKey", "baseUrl", "model", "embeddingModel"] as const;

export function Providers({ active }: { active: boolean }): React.ReactElement {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [fieldIndex, setFieldIndex] = useState(0);
  const [form, setForm] = useState({
    nameIdx: 0,
    apiKey: "",
    baseUrl: "",
    model: "",
    embeddingModel: "",
  });
  const [testResult, setTestResult] = useState<string | undefined>(undefined);
  const [testOk, setTestOk] = useState<boolean | undefined>(undefined);
  const [testing, setTesting] = useState(false);

  async function refresh() {
    const prisma = getPrisma();
    const rows = await prisma.providerConfig.findMany({ orderBy: { createdAt: "asc" } });
    setProviders(rows);
    setSelected((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Live-refresh so a provider change made from elsewhere (another openrm
  // process, etc.) shows up here without navigating away and back. Only
  // affects the list; form-mode drafting is untouched.
  useEffect(() => {
    const interval = setInterval(() => void refresh(), scaledInterval(PROVIDERS_POLL_MS));
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
        if (field === "name") {
          if (key.leftArrow) setForm((f) => ({ ...f, nameIdx: (f.nameIdx - 1 + PROVIDER_NAMES.length) % PROVIDER_NAMES.length }));
          if (key.rightArrow) setForm((f) => ({ ...f, nameIdx: (f.nameIdx + 1) % PROVIDER_NAMES.length }));
          if (key.return) setFieldIndex((i) => (i + 1) % FIELDS.length);
          return;
        }
        if (key.return && fieldIndex === FIELDS.length - 1) {
          void saveForm();
        }
        return;
      }

      // list mode
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(providers.length - 1, i + 1));
      else if (input === "n") {
        setForm({ nameIdx: 0, apiKey: "", baseUrl: "", model: "", embeddingModel: "" });
        setFieldIndex(0);
        setMode("form");
      } else if (input === "a" && providers[selected]) {
        void activate(providers[selected].id);
      } else if (input === "d" && providers[selected]) {
        void remove(providers[selected].id);
      } else if (input === "t" && providers[selected]) {
        void test(providers[selected]);
      }
    },
    { isActive: active }
  );

  async function saveForm() {
    const prisma = getPrisma();
    await prisma.providerConfig.create({
      data: {
        name: PROVIDER_NAMES[form.nameIdx],
        apiKey: form.apiKey || null,
        baseUrl: form.baseUrl || null,
        model: form.model,
        embeddingModel: form.embeddingModel || null,
        isActive: false,
      },
    });
    setMode("list");
    await refresh();
  }

  async function activate(id: string) {
    const prisma = getPrisma();
    await prisma.$transaction([
      prisma.providerConfig.updateMany({ data: { isActive: false }, where: {} }),
      prisma.providerConfig.update({ where: { id }, data: { isActive: true } }),
    ]);
    await refresh();
  }

  async function remove(id: string) {
    const prisma = getPrisma();
    await prisma.providerConfig.delete({ where: { id } });
    setSelected(0);
    await refresh();
  }

  async function test(row: ProviderRow) {
    setTesting(true);
    setTestResult(undefined);
    setTestOk(undefined);
    try {
      const provider = instantiateProvider({
        name: row.name,
        apiKey: row.apiKey ?? undefined,
        baseUrl: row.baseUrl ?? undefined,
        model: row.model,
        embeddingModel: row.embeddingModel ?? undefined,
      });
      const result = await provider.chat(
        [{ role: "user", content: "Reply with the single word OK." }],
        []
      );
      setTestOk(true);
      setTestResult(`model responded: ${(result.content ?? "").slice(0, 80)}`);
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
          {icons.plug} New Provider
        </Text>
        <Field label="Name (←/→)" active={fieldIndex === 0}>
          <Text color={colors.accent}>{PROVIDER_NAMES[form.nameIdx]}</Text>
        </Field>
        <Field label="API Key" active={fieldIndex === 1}>
          <TextInput
            value={form.apiKey}
            onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))}
            active={fieldIndex === 1}
            mask
            placeholder="(optional for ollama)"
          />
        </Field>
        <Field label="Base URL" active={fieldIndex === 2}>
          <TextInput
            value={form.baseUrl}
            onChange={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
            active={fieldIndex === 2}
            placeholder="(provider default)"
          />
        </Field>
        <Field label="Model" active={fieldIndex === 3}>
          <TextInput
            value={form.model}
            onChange={(v) => setForm((f) => ({ ...f, model: v }))}
            active={fieldIndex === 3}
            placeholder="e.g. gpt-4o-mini"
          />
        </Field>
        <Field label="Embedding Model" active={fieldIndex === 4}>
          <TextInput
            value={form.embeddingModel}
            onChange={(v) => setForm((f) => ({ ...f, embeddingModel: v }))}
            active={fieldIndex === 4}
            placeholder="(optional, for RAG)"
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
        {icons.plug} Providers
      </Text>
      <Box marginTop={1} flexDirection="column" gap={1}>
        {providers.length === 0 && <Text dimColor>No providers configured yet. Press "n" to add one.</Text>}
        {providers.map((p, i) => {
          const isSel = active && i === selected;
          return (
            <Box
              key={p.id}
              flexDirection="column"
              borderStyle="round"
              borderColor={isSel ? colors.borderFocus : colors.border}
              paddingX={1}
            >
              <Box justifyContent="space-between">
                <Text bold={isSel} color={isSel ? colors.accent : colors.text}>
                  {isSel ? icons.arrowRight : " "} {p.name}
                </Text>
                {p.isActive && (
                  <Text color={colors.success} bold>
                    {icons.check} ACTIVE
                  </Text>
                )}
              </Box>
              <Text color={colors.textDim}>
                model: {p.model}
                {p.embeddingModel ? ` · embed: ${p.embeddingModel}` : ""}
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
        <Text dimColor>n new · a activate · d delete · t test connection</Text>
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
