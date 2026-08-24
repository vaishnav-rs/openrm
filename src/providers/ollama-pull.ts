/**
 * Shared Ollama model-pull logic, used by OllamaProvider's on-demand
 * auto-pull (src/providers/ollama.ts, triggered when embed() hits a
 * "model not found") and by the Providers screen's embedding-model picker
 * (src/tui/screens/Providers.tsx, triggered explicitly by the user).
 *
 * Uses Ollama's HTTP /api/pull endpoint with stream:true rather than
 * shelling out to the `ollama` CLI binary: it returns newline-delimited
 * JSON progress objects ({status, completed, total}), which is far easier
 * to parse reliably than a terminal-formatted progress bar meant for human
 * eyes, and it only requires the Ollama daemon to be reachable over HTTP --
 * not the `ollama` CLI binary to be on PATH, which some installs/containers
 * don't have even when the daemon itself is running.
 */

export interface OllamaPullProgress {
  status: string;
  completed?: number;
  total?: number;
}

interface OllamaPullLine extends OllamaPullProgress {
  error?: string;
}

/** A short, curated list of well-known, generally-good Ollama embedding models, for the Providers screen's picker. Not exhaustive -- users can still type any model name manually. */
export const KNOWN_OLLAMA_EMBEDDING_MODELS: Array<{ name: string; description: string }> = [
  { name: "nomic-embed-text", description: "137M params, 768-dim -- strong general-purpose default" },
  { name: "mxbai-embed-large", description: "335M params, 1024-dim -- higher quality, larger" },
  { name: "all-minilm", description: "23M params, 384-dim -- fastest and smallest" },
  { name: "bge-m3", description: "567M params, 1024-dim -- multilingual" },
  { name: "snowflake-arctic-embed", description: "335M params, 1024-dim" },
];

/**
 * Streams a `POST {baseUrl}/api/pull` request, calling onProgress for each
 * NDJSON line Ollama emits as the download/verify proceeds. Resolves when
 * Ollama reports completion (a final line with no `total`/`completed` left
 * to report, or status "success"); rejects on a non-OK HTTP response, an
 * `{error}` line in the stream, or a network/parse failure.
 */
export async function pullOllamaModel(
  model: string,
  baseUrl: string,
  onProgress?: (p: OllamaPullProgress) => void
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });

  if (!res.ok || !res.body) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Ollama pull request failed: ${res.status} ${bodyText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let parsed: OllamaPullLine;
      try {
        parsed = JSON.parse(line) as OllamaPullLine;
      } catch {
        // A partial/garbled line split across chunk boundaries -- rare with
        // NDJSON over a single read loop, but never worth aborting the pull
        // over a single unparseable line.
        continue;
      }

      if (parsed.error) {
        throw new Error(`Ollama pull failed: ${parsed.error}`);
      }
      onProgress?.({ status: parsed.status, completed: parsed.completed, total: parsed.total });
    }
  }
}
