import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPrisma } from "../db/prisma.js";
import { saveConfig } from "../config/config.js";
import { getOpenrmHome, getSoulPath } from "../setup/paths.js";
import { isDockerAvailable, provisionPostgresViaDocker } from "../setup/docker-detect.js";
import { instantiateProvider } from "../providers/registry.js";
import { ingestFile } from "../rag/ingest.js";
import { TextInput } from "../tui/TextInput.js";
import { TextArea } from "../tui/TextArea.js";

type Step =
  | "database"
  | "migrating"
  | "soul"
  | "system-prompt"
  | "provider"
  | "testing-provider"
  | "rag"
  | "finishing"
  | "done";

const PROVIDER_NAMES = ["ollama", "openai", "anthropic", "openai-compatible"] as const;

function findPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/onboarding.js -> package root is two levels up.
  const candidates = [join(here, "..", ".."), join(here, "..", "..", "..")];
  for (const c of candidates) {
    if (existsSync(join(c, "prisma", "schema.prisma"))) return c;
  }
  return candidates[0];
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: process.platform === "win32", env });
    let output = "";
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.on("error", (err) => resolve({ code: 1, output: String(err) }));
  });
}

function loadDefaultSoul(): string {
  const root = findPackageRoot();
  const path = join(root, "templates", "soul.default.md");
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return "# Soul\n\nYou are a helpful, concise customer-facing WhatsApp assistant.\n";
}

const DEFAULT_SYSTEM_PROMPT =
  "You are the WhatsApp assistant for this business. Use your tools to remember " +
  "customer names and interests as soon as you learn them. Keep replies short, " +
  "friendly, and grounded in what you actually know about the business.";

export interface OnboardingWizardProps {
  onComplete: () => void;
}

/**
 * Ink onboarding wizard, run when ~/.openrm/config.json is missing (or via
 * `openrm init`). Walks through: Postgres provisioning, running migrations,
 * seeding soul.md, the master system prompt, provider setup with a live
 * connection test, and optional RAG document ingestion -- then writes
 * ~/.openrm/config.json and hands control back to the caller, which
 * launches the dashboard.
 */
export function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.ReactElement {
  const [step, setStep] = useState<Step>("database");
  const [log, setLog] = useState<string[]>([]);

  const [dbMode, setDbMode] = useState<"checking" | "choose" | "docker" | "manual">("checking");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [provisionedViaDocker, setProvisionedViaDocker] = useState(false);

  const [soul, setSoul] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);

  const [providerNameIdx, setProviderNameIdx] = useState(0);
  const [providerFieldIdx, setProviderFieldIdx] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [providerTestResult, setProviderTestResult] = useState<string | undefined>(undefined);

  const [ragPath, setRagPath] = useState("");
  const [ragStatus, setRagStatus] = useState<string | undefined>(undefined);

  function appendLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  // Step: database detection
  useEffect(() => {
    if (step !== "database") return;
    let cancelled = false;
    async function detect() {
      const available = await isDockerAvailable();
      if (!cancelled) setDbMode(available ? "choose" : "manual");
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, [step]);

  useInput(
    (input) => {
      if (step !== "database" || dbMode !== "choose") return;
      if (input === "1") {
        setDbMode("docker");
        void (async () => {
          appendLog("Provisioning Postgres via Docker...");
          try {
            const result = await provisionPostgresViaDocker((msg) => appendLog(msg));
            setDatabaseUrl(result.databaseUrl);
            setProvisionedViaDocker(true);
            appendLog("Postgres is up.");
            setStep("migrating");
          } catch (err) {
            appendLog(`Docker provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
            setDbMode("manual");
          }
        })();
      } else if (input === "2") {
        setDbMode("manual");
      }
    },
    { isActive: step === "database" && dbMode === "choose" }
  );

  function handleDatabaseUrlSubmit(value: string) {
    if (!value.trim()) return;
    setDatabaseUrl(value.trim());
    setStep("migrating");
  }

  // Step: migrating
  useEffect(() => {
    if (step !== "migrating") return;
    let cancelled = false;
    async function migrate() {
      const root = findPackageRoot();
      appendLog("Running `prisma migrate deploy`...");
      const result = await runCommand(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["prisma", "migrate", "deploy", "--schema", join(root, "prisma", "schema.prisma")],
        { ...process.env, DATABASE_URL: databaseUrl }
      );
      if (cancelled) return;
      appendLog(result.output.trim().slice(-2000));
      if (result.code !== 0) {
        appendLog("Migration failed. Fix DATABASE_URL/connectivity and restart `openrm init`.");
        return;
      }
      process.env.DATABASE_URL = databaseUrl;
      setSoul(loadDefaultSoul());
      setStep("soul");
    }
    void migrate();
    return () => {
      cancelled = true;
    };
  }, [step]);

  // Step: soul
  useInput(
    (_input, key) => {
      if (step !== "soul") return;
      if (key.ctrl === false && key.return === false) return;
    },
    { isActive: step === "soul" }
  );

  function finishSoulStep() {
    const home = getOpenrmHome();
    if (!existsSync(home)) mkdirSync(home, { recursive: true });
    writeFileSync(getSoulPath(), soul, "utf-8");
    setStep("system-prompt");
  }

  function finishSystemPromptStep() {
    setStep("provider");
  }

  const PROVIDER_FIELDS = ["name", "apiKey", "baseUrl", "model", "embeddingModel"] as const;

  useInput(
    (input, key) => {
      if (step !== "provider") return;
      if (key.tab) {
        setProviderFieldIdx((i) => (i + 1) % PROVIDER_FIELDS.length);
        return;
      }
      const field = PROVIDER_FIELDS[providerFieldIdx];
      if (field === "name" && (key.leftArrow || key.rightArrow)) {
        setProviderNameIdx((i) => (i + (key.rightArrow ? 1 : -1) + PROVIDER_NAMES.length) % PROVIDER_NAMES.length);
        return;
      }
      if (field === "name" && key.return) {
        setProviderFieldIdx((i) => i + 1);
        return;
      }
      if (key.return && providerFieldIdx === PROVIDER_FIELDS.length - 1) {
        setStep("testing-provider");
      }
    },
    { isActive: step === "provider" }
  );

  useEffect(() => {
    if (step !== "testing-provider") return;
    let cancelled = false;
    async function testAndSave() {
      const name = PROVIDER_NAMES[providerNameIdx];
      try {
        const provider = instantiateProvider({
          name,
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          model: model || "default",
          embeddingModel: embeddingModel || undefined,
        });
        const result = await provider.chat(
          [{ role: "user", content: "Reply with the single word OK." }],
          []
        );
        if (cancelled) return;
        setProviderTestResult(`Connected -- model said: ${(result.content ?? "").slice(0, 80)}`);
      } catch (err) {
        if (cancelled) return;
        setProviderTestResult(
          `Could not verify provider (saving anyway): ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const prisma = getPrisma();
      await prisma.providerConfig.updateMany({ data: { isActive: false }, where: {} });
      await prisma.providerConfig.create({
        data: {
          name,
          apiKey: apiKey || null,
          baseUrl: baseUrl || null,
          model: model || "default",
          embeddingModel: embeddingModel || null,
          isActive: true,
        },
      });
      await prisma.agentConfig.upsert({
        where: { id: "1" },
        update: { masterSystemPrompt: systemPrompt },
        create: { id: "1", masterSystemPrompt: systemPrompt },
      });

      if (!cancelled) {
        setTimeout(() => setStep("rag"), 1200);
      }
    }
    void testAndSave();
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function handleRagSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setStep("finishing");
      return;
    }
    setRagStatus("Ingesting...");
    try {
      const result = await ingestFile(trimmed);
      setRagStatus(`Ingested ${result.filename}: ${result.chunkCount} chunks. Enter another path or press Enter to continue.`);
      setRagPath("");
    } catch (err) {
      setRagStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      setRagPath("");
    }
  }

  useInput(
    (_input, key) => {
      if (step !== "rag") return;
      if (key.escape) setStep("finishing");
    },
    { isActive: step === "rag" }
  );

  // Step: finishing
  useEffect(() => {
    if (step !== "finishing") return;
    saveConfig({
      databaseUrl,
      provisionedViaDocker,
      onboardedAt: new Date().toISOString(),
    });
    setStep("done");
  }, [step]);

  useEffect(() => {
    if (step === "done") {
      onComplete();
    }
  }, [step]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        openrm setup
      </Text>

      {step === "database" && dbMode === "checking" && <Text>Checking for Docker...</Text>}

      {step === "database" && dbMode === "choose" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Docker was detected. How should I set up Postgres (with pgvector)?</Text>
          <Text>1. Provision automatically via Docker</Text>
          <Text>2. I'll provide my own DATABASE_URL</Text>
        </Box>
      )}

      {step === "database" && dbMode === "manual" && (
        <Box marginTop={1}>
          <Text>DATABASE_URL: </Text>
          <TextInput
            value={databaseUrl}
            onChange={setDatabaseUrl}
            onSubmit={handleDatabaseUrlSubmit}
            active={step === "database" && dbMode === "manual"}
            placeholder="postgresql://user:pass@host:5432/db"
          />
        </Box>
      )}

      {(step === "database" || step === "migrating") && log.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {log.slice(-8).map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}

      {step === "soul" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Edit the agent's soul (persona &amp; standing behavior). Ctrl+D when done.
          </Text>
          <SoulEditor value={soul} onChange={setSoul} onDone={finishSoulStep} active={step === "soul"} />
        </Box>
      )}

      {step === "system-prompt" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Master system prompt (business-specific instructions). Ctrl+D when done.</Text>
          <SoulEditor
            value={systemPrompt}
            onChange={setSystemPrompt}
            onDone={finishSystemPromptStep}
            active={step === "system-prompt"}
          />
        </Box>
      )}

      {step === "provider" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Choose your LLM provider (Tab to move fields, Enter on last field to continue):</Text>
          <ProviderField label="Provider (←/→)" active={providerFieldIdx === 0}>
            <Text>{PROVIDER_NAMES[providerNameIdx]}</Text>
          </ProviderField>
          <ProviderField label="API Key" active={providerFieldIdx === 1}>
            <TextInput value={apiKey} onChange={setApiKey} active={providerFieldIdx === 1} mask placeholder="(optional for ollama)" />
          </ProviderField>
          <ProviderField label="Base URL" active={providerFieldIdx === 2}>
            <TextInput value={baseUrl} onChange={setBaseUrl} active={providerFieldIdx === 2} placeholder="(provider default)" />
          </ProviderField>
          <ProviderField label="Model" active={providerFieldIdx === 3}>
            <TextInput value={model} onChange={setModel} active={providerFieldIdx === 3} placeholder="e.g. gpt-4o-mini" />
          </ProviderField>
          <ProviderField label="Embedding Model" active={providerFieldIdx === 4}>
            <TextInput
              value={embeddingModel}
              onChange={setEmbeddingModel}
              active={providerFieldIdx === 4}
              placeholder="(optional, for RAG)"
            />
          </ProviderField>
        </Box>
      )}

      {step === "testing-provider" && (
        <Box marginTop={1} flexDirection="column">
          <Text>Testing provider connection...</Text>
          {providerTestResult && <Text>{providerTestResult}</Text>}
        </Box>
      )}

      {step === "rag" && (
        <Box marginTop={1} flexDirection="column">
          <Text>Optionally ingest a knowledge-base file (.txt/.md/.pdf) for RAG. Esc to skip/continue.</Text>
          <Box>
            <Text>Path: </Text>
            <TextInput
              value={ragPath}
              onChange={setRagPath}
              onSubmit={handleRagSubmit}
              active={step === "rag"}
              placeholder="/path/to/menu.pdf (Enter with empty path to continue)"
            />
          </Box>
          {ragStatus && <Text dimColor>{ragStatus}</Text>}
        </Box>
      )}

      {step === "finishing" && <Text>Saving configuration...</Text>}
      {step === "done" && <Text color="green">Setup complete. Launching dashboard...</Text>}
    </Box>
  );
}

function ProviderField({
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

function SoulEditor({
  value,
  onChange,
  onDone,
  active,
}: {
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;
  active: boolean;
}): React.ReactElement {
  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && input === "d") {
        onDone();
      }
    },
    { isActive: active }
  );
  return <TextArea value={value} onChange={onChange} active={active} height={10} />;
}
