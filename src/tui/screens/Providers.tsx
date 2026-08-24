import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { instantiateProvider } from "../../providers/registry.js";
import {
  KNOWN_OLLAMA_EMBEDDING_MODELS,
  pullOllamaModel,
  type OllamaPullProgress,
} from "../../providers/ollama-pull.js";
import { TextInput } from "../TextInput.js";
import { colors, icons } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";

const PROVIDERS_POLL_MS = 4000;
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

function PullSpinner(): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % icons.spinner.length), scaledInterval(150));
    return () => clearInterval(id);
  }, []);
  return <Text color={colors.warning}>{icons.spinner[frame]}</Text>;
}

const PROGRESS_BAR_WIDTH = 30;

function PullProgressBar({ progress }: { progress: OllamaPullProgress }): React.ReactElement {
  if (progress.total && progress.completed !== undefined) {
    const ratio = Math.min(1, progress.completed / progress.total);
    const filled = Math.round(ratio * PROGRESS_BAR_WIDTH);
    const bar = "█".repeat(filled) + "░".repeat(PROGRESS_BAR_WIDTH - filled);
    const pct = Math.round(ratio * 100);
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={colors.accent}>{bar}</Text>
        <Text color={colors.textDim}>
          {pct}% · {progress.status}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row" gap={1}>
      <PullSpinner />
      <Text color={colors.textDim}>{progress.status}</Text>
    </Box>
  );
}

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
  const [mode, setMode] = useState<"list" | "form" | "embed-picker">("list");
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

  // Embedding-model picker (ollama only): pick from a curated list of known
  // embedding models and pull it with a live streamed progress bar, rather
  // than requiring the user to know an exact model name and pull it out of
  // band. Separate from OllamaProvider's own silent on-demand auto-pull
  // (src/providers/ollama.ts) -- this is the proactive, user-driven path;
  // that one is the safety net if a model gets configured without ever
  // being pulled through here.
  const [embedPickerIndex, setEmbedPickerIndex] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<OllamaPullProgress | undefined>(undefined);
  const [pullError, setPullError] = useState<string | undefined>(undefined);

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

      if (mode === "embed-picker") {
        if (pulling) return; // let the pull finish before accepting more input
        if (key.escape) {
          setMode("list");
          return;
        }
        if (key.upArrow) {
          setEmbedPickerIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setEmbedPickerIndex((i) => Math.min(KNOWN_OLLAMA_EMBEDDING_MODELS.length - 1, i + 1));
        } else if (key.return) {
          void pullAndSetEmbedding(KNOWN_OLLAMA_EMBEDDING_MODELS[embedPickerIndex].name);
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
      } else if (input === "e" && providers[selected]?.name === "ollama") {
        setEmbedPickerIndex(0);
        setPullProgress(undefined);
        setPullError(undefined);
        setMode("embed-picker");
      }
    },
    { isActive: active }
  );

  async function pullAndSetEmbedding(modelName: string): Promise<void> {
    const row = providers[selected];
    if (!row) return;
    setPulling(true);
    setPullError(undefined);
    setPullProgress(undefined);
    try {
      const baseUrl = row.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
      await pullOllamaModel(modelName, baseUrl, setPullProgress);
      const prisma = getPrisma();
      await prisma.providerConfig.update({
        where: { id: row.id },
        data: { embeddingModel: modelName },
      });
      await refresh();
      setMode("list");
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  }

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

  if (mode === "embed-picker") {
    const row = providers[selected];
    return (
      <Box flexDirection="column">
        <Text bold color={colors.text}>
          {icons.plug} Pull Embedding Model {row ? `for ${row.name}` : ""}
        </Text>
        <Text dimColor>Used for RAG document/query embedding -- not the chat model.</Text>
        <Box marginTop={1} flexDirection="column" gap={1}>
          {KNOWN_OLLAMA_EMBEDDING_MODELS.map((m, i) => {
            const isSel = i === embedPickerIndex;
            const isCurrent = row?.embeddingModel === m.name;
            return (
              <Box key={m.name} flexDirection="column">
                <Text bold={isSel} color={isSel ? colors.accent : colors.text}>
                  {isSel ? icons.arrowRight : " "} {m.name}
                  {isCurrent ? " (current)" : ""}
                </Text>
                <Text color={colors.textDim}>  {m.description}</Text>
              </Box>
            );
          })}
        </Box>
        {pulling && pullProgress && (
          <Box marginTop={1}>
            <PullProgressBar progress={pullProgress} />
          </Box>
        )}
        {pulling && !pullProgress && (
          <Box marginTop={1} flexDirection="row" gap={1}>
            <PullSpinner />
            <Text color={colors.textDim}>Starting pull...</Text>
          </Box>
        )}
        {pullError && !pulling && (
          <Box marginTop={1}>
            <Text color={colors.error}>
              {icons.cross} {pullError}
            </Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            {pulling ? "Pulling -- please wait..." : "↑/↓ select · ↵ pull & set as embedding model · Esc cancel"}
          </Text>
        </Box>
      </Box>
    );
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
        <Text dimColor>
          n new · a activate · d delete · t test connection
          {providers[selected]?.name === "ollama" ? " · e pull embedding model" : ""}
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
