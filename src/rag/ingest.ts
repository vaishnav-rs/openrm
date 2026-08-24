import { readFileSync } from "node:fs";
import { basename, extname, isAbsolute, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { getPrisma } from "../db/prisma.js";
import { getActiveProvider } from "../providers/registry.js";

/**
 * Cleans up a user-supplied path before it's used for anything, and
 * resolves it correctly whether it's absolute or relative.
 *
 * This guards against the common ways a pasted path arrives dirty from a
 * raw single-line TextInput: surrounding quotes left over from Windows
 * "Copy as path", trailing whitespace, and a leading `~`. Critically, an
 * already-absolute path (including Windows drive-letter paths like
 * `C:\...` and UNC paths like `\\server\share\...`, which `path.isAbsolute`
 * correctly recognizes) must NOT be joined/resolved against `process.cwd()`
 * -- doing that was the bug: it silently prefixed the cwd onto paths that
 * were already absolute.
 */
export function resolveUserPath(input: string): string {
  let cleaned = input.trim();

  // Strip one layer of surrounding matching quotes, e.g. from a Windows
  // "Copy as path" paste: "C:\Users\...\file.pdf".
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Expand a leading ~ or ~/ to the user's home directory.
  if (cleaned === "~") {
    cleaned = homedir();
  } else if (cleaned.startsWith("~/") || cleaned.startsWith("~\\")) {
    cleaned = homedir() + cleaned.slice(1);
  }

  if (isAbsolute(cleaned)) {
    return normalize(cleaned);
  }
  return resolve(process.cwd(), cleaned);
}

const APPROX_CHARS_PER_TOKEN = 4;
const CHUNK_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;
const CHUNK_CHARS = CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;
const OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;

async function readFileText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") {
    // Lazy import: pdf-parse pulls in some heavier deps we don't want to
    // load for the common .txt/.md ingestion path.
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = readFileSync(path);
    const data = await pdfParse(buffer);
    return data.text;
  }
  // .txt / .md / anything else: read directly as UTF-8 text.
  return readFileSync(path, "utf-8");
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_CHARS, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = end - OVERLAP_CHARS;
    if (start < 0) start = 0;
  }
  return chunks;
}

export interface IngestResult {
  documentId: string;
  filename: string;
  chunkCount: number;
}

/**
 * Reads a local .txt/.md/.pdf file, splits it into ~500-token chunks with
 * slight overlap, embeds each chunk via the active provider, and inserts
 * Document + Chunk rows. Chunk.embedding is written via raw SQL since Prisma
 * cannot set an Unsupported("vector") column through the normal client API.
 */
export async function ingestFile(path: string): Promise<IngestResult> {
  const resolvedPath = resolveUserPath(path);
  const filename = basename(resolvedPath);
  const text = await readFileText(resolvedPath);
  const chunks = chunkText(text);

  const prisma = getPrisma();
  const provider = await getActiveProvider();

  const document = await prisma.document.create({
    data: { filename, sourcePath: resolvedPath },
  });

  for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
    const content = chunks[ordinal];
    const embedding = await provider.embed(content);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const chunk = await prisma.chunk.create({
      data: {
        documentId: document.id,
        content,
        ordinal,
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
      vectorLiteral,
      chunk.id
    );
  }

  return { documentId: document.id, filename, chunkCount: chunks.length };
}

export async function listDocuments() {
  const prisma = getPrisma();
  const documents = await prisma.document.findMany({
    include: { _count: { select: { chunks: true } } },
    orderBy: { createdAt: "desc" },
  });
  return documents.map((d) => ({
    id: d.id,
    filename: d.filename,
    sourcePath: d.sourcePath,
    createdAt: d.createdAt,
    chunkCount: d._count.chunks,
  }));
}

export async function deleteDocument(documentId: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.document.delete({ where: { id: documentId } });
}
