# openrm

`openrm` is an npm-installable CLI that runs a WhatsApp-based CRM agent. You
pair a business's WhatsApp number via QR code (using
[Baileys](https://github.com/WhiskeySockets/Baileys) -- not the Meta Business
Cloud API), and when a customer messages that number, an LLM-powered agent
replies conversationally and saves their name, phone number, and interests
into Postgres.

## It never starts a conversation

**openrm's agent never starts a conversation with a customer on its own.**
There is no scheduler, cron job, queue-drainer, or broadcast path anywhere in
this codebase. The *entire* codebase has exactly three calls to
`sock.sendMessage(...)` (the Baileys "send" API), and all three live in
[`src/whatsapp/handlers.ts`](./src/whatsapp/handlers.ts) so the guarantee
below stays auditable from one file:

```sh
grep -rn "sendMessage" src/
```

You should find exactly three functional call sites:

1. **The reactive customer reply** -- directly inside the `messages.upsert`
   handler, sending only to the JID that triggered it. Unchanged since the
   very first version of this app. (Skipped, sending nothing, when the
   conversation has been manually taken over by a human -- see #3 below.)
2. **Human handoff staff alert** (`notifyStaffOfEscalation`) -- a narrow,
   deliberate exception, not a violation of the guarantee above. When the
   agent's `request_human_handoff` tool
   ([`src/agent/tools/handoff.ts`](./src/agent/tools/handoff.ts)) decides a
   conversation needs a human -- which only happens when the customer
   *explicitly* asks to speak to a person, or the agent has genuinely
   exhausted its ability to help -- it flags the conversation
   (`Conversation.needsHuman`) and, if a dedicated staff number is
   configured (`AgentConfig.escalationPhone`, editable from the "System
   Prompt" dashboard screen), sends that one pre-configured internal number
   a short WhatsApp alert with the customer's info and a reason. This still
   fires **only** as a direct, synchronous consequence of a real inbound
   customer message (there is no timer/queue path to it), and it **never**
   messages a customer or any new/discovered external party -- only the
   single fixed internal staff number the business itself configured.
3. **Manual staff reply** (`sendManualMessage`) -- fundamentally different in
   kind from #1 and #2, and the one exception that is not "reactive to an
   inbound message" at all: it's a human operator directly using the
   dashboard's **Conversations** screen
   ([`src/tui/screens/ConversationsFeed.tsx`](./src/tui/screens/ConversationsFeed.tsx))
   as a live-chat console -- selecting a contact, typing into the compose
   box at the bottom of that screen, and pressing Enter -- exactly like
   using WhatsApp Web itself, just through this dashboard. **It is never
   triggerable by the agent/LLM or by any tool** -- there is no AgentTool,
   MCP tool, or orchestrator branch anywhere that calls it; its only caller
   is that screen's Enter-key handler, gated on the operator having
   explicitly navigated into the compose box (`focus === "compose"`). Sending
   a manual message also flags the conversation `humanControlled = true` (via
   the screen's "Jump In" keybinding, or automatically alongside the send),
   which makes `src/agent/orchestrator.ts`'s `handleInbound` skip the
   automatic reply loop for that conversation entirely -- so the bot and a
   human staff member can never reply to the same customer message at the
   same time. A "Release to bot" toggle in the same screen clears
   `humanControlled` and hands the conversation back to the agent; it is
   never a one-way trap. The dashboard surfaces conversations flagged
   `needsHuman` with a red row highlight so staff can see and jump into them
   without leaving the app; openrm itself never sends anything on a
   conversation beyond these three explicit cases.

## Install

```sh
npm i -g openrm
openrm
```

Running `openrm` with no config yet will walk you through onboarding. You can
also run it explicitly:

```sh
openrm init
```

### Setup, step by step

1. **Postgres.** openrm needs a Postgres database with the
   [pgvector](https://github.com/pgvector/pgvector) extension. During
   onboarding, if Docker is available on your machine, openrm can offer to
   provision this for you by copying
   [`templates/docker-compose.yml`](./templates/docker-compose.yml) to
   `~/.openrm/docker-compose.yml` and running
   `docker compose up -d postgres`. Otherwise, supply your own
   `DATABASE_URL` (any Postgres 14+ instance with `pgvector` installed).

   **Important: the tool that built this package never ran Docker or the
   app itself.** All Docker/`docker compose` invocations happen only when
   *you* run `openrm` (or `docker compose` directly) on your own machine.
   `src/setup/docker-detect.ts` exports plain library functions
   (`isDockerAvailable`, `provisionPostgresViaDocker`) that are only invoked
   from the interactive onboarding wizard at your runtime.

2. **Migrations.** openrm ships hand-authored SQL migrations under
   `prisma/migrations/` (standard Prisma migration format) rather than
   relying on `prisma migrate dev`, which needs an interactive session
   against an empty dev database -- unsuitable for a globally-installed CLI.
   Onboarding runs `prisma migrate deploy` against your `DATABASE_URL`, the
   standard non-interactive way to apply migrations for a distributed tool.
   `npx prisma validate` and `npx prisma generate` only read `schema.prisma`
   and require no live database connection; both were confirmed to pass
   while building this package.

3. **Soul vs. system prompt.** openrm's agent behavior is split into two
   layers:
   - **`~/.openrm/soul.md`** -- the agent's persona and standing behavioral
     rules (tone, "never share other customers' info", etc). It's a plain
     Markdown file, seeded from
     [`templates/soul.default.md`](./templates/soul.default.md), and is
     **read fresh from disk on every single inbound message** -- edit it in
     the "Soul" dashboard screen (or any text editor) and the very next
     reply reflects the change, no restart needed.
   - **Master system prompt** (`AgentConfig.masterSystemPrompt` in Postgres)
     -- business-specific instructions (what the business sells, policies,
     etc), edited from the "System Prompt" dashboard screen.

   The orchestrator (`src/agent/orchestrator.ts`) builds the final system
   prompt as `soul.md + "\n\n" + masterSystemPrompt` on every message.

4. **Provider.** Pick an LLM provider during onboarding, or later from the
   "Providers" dashboard screen: Ollama (local), OpenAI, Anthropic, or any
   OpenAI-compatible endpoint (Groq, OpenRouter, self-hosted vLLM, etc).
   Providers are rows in the `ProviderConfig` table; exactly one has
   `isActive = true` at a time, and `src/providers/registry.ts` re-reads
   that row on every message -- so you can swap providers live from the
   dashboard without restarting. Each provider implements a shared
   `LLMProvider` interface (`chat()`, `embed()`) so the agent's tool-calling
   loop in `src/agent/orchestrator.ts` is entirely provider-agnostic.

   Anthropic has no public embeddings API: `AnthropicProvider.embed()`
   throws a descriptive `UnsupportedOperationError` telling you to configure
   a different provider's `embeddingModel` for RAG if you want to use
   Claude for chat.

5. **RAG (optional).** Ingest local `.txt`/`.md`/`.pdf` files from the "RAG
   Documents" dashboard screen (or during onboarding). Files are chunked
   (~500 tokens, slight overlap), embedded via the active provider, and
   stored as `Document`/`Chunk` rows. `Chunk.embedding` is a
   `vector(1536)` column (see "Embedding dimension" below); the agent's
   `retrieve_knowledge` tool does a raw-SQL pgvector cosine search over it.

6. **MCP servers (optional).** Add MCP servers (stdio command+args, or an
   HTTP URL) from the "MCP Servers" dashboard screen. Enabled servers are
   connected to on demand for each inbound message, their tools are listed
   and merged (namespaced as `serverName__toolName`) into the agent's tool
   set, and then the connection is dropped -- no persistent background
   connections, keeping the whole system purely reactive.

7. Once setup finishes, openrm launches the terminal dashboard (built with
   [Ink](https://github.com/vadimdemedes/ink)): scan the QR code on the
   "Pairing" screen with WhatsApp (Settings → Linked Devices), and you're
   live.

## Embedding dimension

`Chunk.embedding` is declared as `vector(1536)` (matching, e.g., OpenAI's
`text-embedding-3-small`). If your provider/model produces a different
dimension, update every `vector(1536)` occurrence in
[`prisma/schema.prisma`](./prisma/schema.prisma) and
[`prisma/migrations/0001_init/migration.sql`](./prisma/migrations/0001_init/migration.sql)
before ingesting any documents, then re-run migrations.

## Dashboard

`openrm` (or `openrm pair`) launches an Ink-based terminal dashboard with:

- **Dashboard** -- connection status, contact/message counts.
- **Pairing** -- live QR code + connection state.
- **Conversations** -- a per-conversation view: a live-updating list of
  conversations on the left (most recently active first, rows needing a
  human highlighted in red), the selected contact's full message thread on
  the right, a "Jump In" / "Release to bot" toggle (`j`) that pauses/resumes
  the agent's automatic replies for that conversation, and a compose box to
  send a reply directly as staff (see "It never starts a conversation"
  above for exactly how that interacts with the reactive-only guarantee).
- **Contacts** -- browse contacts, drill into interests + history.
- **Providers** -- add/activate/test LLM providers.
- **Soul** -- edit `~/.openrm/soul.md` directly.
- **System Prompt** -- edit the database-backed master system prompt.
- **RAG Documents** -- ingest/list/delete knowledge-base files.
- **MCP Servers** -- add/enable/test MCP tool servers.

Navigate with arrow keys + Enter; Esc/`q` returns focus to the left nav.

## CLI commands

| Command         | Description                                              |
| ---------------- | --------------------------------------------------------- |
| `openrm` / `openrm start` | Start openrm (runs onboarding first if unconfigured) |
| `openrm init`     | Run (or re-run) the onboarding wizard                     |
| `openrm pair`     | Connect to WhatsApp and show the dashboard                |
| `openrm status`   | Print setup status without launching anything              |
| `openrm reset --yes` | Delete all local state (`~/.openrm`): config, WhatsApp auth, soul.md |

## Configuration reference

- `~/.openrm/config.json` -- bootstrap state (Postgres connection info,
  onboarding timestamp). See `src/config/config.ts`.
- `~/.openrm/soul.md` -- agent persona, see above.
- `~/.openrm/auth/` -- Baileys `useMultiFileAuthState` session data (your
  WhatsApp pairing). Treat this like a password.
- `DATABASE_URL` environment variable, if set, overrides the database URL
  stored in `config.json` (see `src/config/env.ts`).
- `.env.example` in this repo shows the shape of `DATABASE_URL` used when
  developing/building openrm itself (`npx prisma validate`, etc) -- it is
  **not** required for an installed `openrm` to run, since the CLI manages
  its own `~/.openrm/config.json`.

## Docker

[`templates/docker-compose.yml`](./templates/docker-compose.yml) and
[`templates/Dockerfile`](./templates/Dockerfile) are provided as complete,
ready-to-run deliverables for *you* to use on *your* machine -- a `postgres`
service (using `pgvector/pgvector:pg16`) and an optional `app` service (with
`tty: true` / `stdin_open: true` so you can attach for QR-code pairing).

```sh
# from a copy of this repo, or from ~/.openrm/docker-compose.yml after
# choosing Docker-provisioning during onboarding:
docker compose up -d postgres
# optional: run openrm itself in a container (needs an attached TTY)
docker compose run --rm app
```

**The tool that authored this repository never ran `docker`, `docker
compose`, or the `openrm` app itself.** All of the above commands are for
you to run yourself.

## Architecture

```
src/
├── cli/          CLI entrypoint (commander) + onboarding wizard (Ink)
├── tui/          Ink dashboard app, screens, and the typed event bus
├── whatsapp/     Baileys socket setup + the single inbound message handler
├── agent/        Orchestrator, CRM/RAG tools, MCP client
├── providers/    Provider-agnostic LLMProvider interface + implementations
├── rag/          Document ingestion (chunking + embedding)
├── setup/        Path helpers + Docker detection/provisioning (library only)
├── db/           Prisma client singleton
└── config/       Env var loading + ~/.openrm/config.json handling
```

See the "It never starts a conversation" section above for the one hard
architectural guarantee this whole layout exists to protect.
