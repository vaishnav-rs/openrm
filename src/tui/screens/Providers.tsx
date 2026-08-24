import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { instantiateProvider } from "../../providers/registry.js";
import { TextInput } from "../TextInput.js";

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
  const [testing, setTesting] = useState(false);

  async function refresh() {
    const prisma = getPrisma();
    const rows = await prisma.providerConfig.findMany({ orderBy: { createdAt: "asc" } });
    setProviders(rows);
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
      setTestResult(`OK -- model responded: ${(result.content ?? "").slice(0, 80)}`);
    } catch (err) {
      setTestResult(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  }

  if (mode === "form") {
    return (
      <Box flexDirection="column">
        <Text bold>New Provider</Text>
        <Field label="Name (←/→)" active={fieldIndex === 0}>
          <Text>{PROVIDER_NAMES[form.nameIdx]}</Text>
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
          <Text dimColor>Tab to move fields, Enter on last field to save, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Providers</Text>
      <Box marginTop={1} flexDirection="column">
        {providers.length === 0 && <Text dimColor>No providers configured yet. Press "n" to add one.</Text>}
        {providers.map((p, i) => (
          <Text key={p.id} color={active && i === selected ? "green" : undefined}>
            {active && i === selected ? "> " : "  "}
            {p.isActive ? "* " : "  "}
            {p.name} ({p.model})
          </Text>
        ))}
      </Box>
      {testing && <Text dimColor>Testing...</Text>}
      {testResult && <Text>{testResult}</Text>}
      <Box marginTop={1}>
        <Text dimColor>n new, a activate, d delete, t test connection</Text>
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
        <Text color={active ? "green" : undefined}>{label}:</Text>
      </Box>
      {children}
    </Box>
  );
}
