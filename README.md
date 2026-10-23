# Agentdex

A local interface for coding agent sessions. Launch Codex, Antigravity CLI, or OpenCode in a working directory and use its native terminal directly in your browser.

## Development

Requires Node.js 22.12+, pnpm 10.22.0, and the CLIs you want to use installed and authenticated (`codex`, `agy`, OpenCode v2's `opencode`). Installing `node-pty` may require Python, make, and a C++ compiler on Linux. Antigravity history uses Node's built-in SQLite reader; Node 22 may emit an experimental-feature notice.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/sessions` and click **New session** or the **+** beside the session tabs. Choose a provider and select a recent working directory or enter a path, then click **Launch session** in the modal. `~` and `~/path` are supported. Each CLI uses your existing configuration and authentication. Native prompts and approvals appear in the embedded terminal.

`pnpm dev` starts the client on port 5173 and the server on port 3001. If the client is already running, use `pnpm dev:server`; `pnpm dev:client` starts just the client. Vite proxies HTTP and WebSocket traffic under `/api` to the server.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

After building, `pnpm start` serves both the compiled client and API at `http://127.0.0.1:3001`. `pnpm preview` previews the client build and requires a running backend.

The backend accepts optional `PORT`, `CODEX_BIN`, `AGY_BIN`, and `OPENCODE_BIN` environment variables. For example, `AGY_BIN=/absolute/path/to/agy pnpm dev:server`. `AGY_HISTORY_DB` can override the Antigravity summary database path for discovery; it does not change where the CLI stores its own data. The Vite proxy targets port 3001; update its target if changing the backend port during development.

## Structure

- `apps/client`: Vite, React, TypeScript, Tailwind CSS, shadcn/ui, and React Router data mode. Pages colocate loaders/actions; layouts own the app shell. Session reads, launches, and stops use route loaders/actions.
- `apps/server`: Express and TypeScript. Routes dispatch to controllers, services own PTY lifecycle, models describe session runtime state, and middleware restricts local access. The terminal controller handles WebSocket input, output, resizing, and replay.
- `packages/shared`: Type-only API and terminal-message contracts used by both apps.

## Provider adapters

`apps/server/src/lib/providers` is the bridge between providers and session execution. Each adapter defines an ID, display name, installation guidance, `listSessions()` for native saved history, and `getLaunchConfig(workingDirectory)` returning an executable, argument array, and optional environment overrides. Provider-specific code is grouped into `codex/`, `agy/`, and `opencode/`, each with an `index.ts` adapter and `sessions.ts` history implementation; Antigravity deletion lives in `agy/delete.ts`. Shared activity checks and adapter types stay at the provider root. Codex owns its `CODEX_BIN` setting in `codex/index.ts`; executable availability is checked when launching.

To add a provider, create its adapter and register it in `lib/providers/index.ts`. Session routes, controllers, terminal transport, and client selector do not need provider-specific changes. The selector reads public metadata from `/api/providers`; executable configuration and environment values stay on the server. Codex, Antigravity CLI, and OpenCode are registered, with Codex as the default.

## Session behavior

The sessions page lists saved history from every registered provider, including sessions started outside Agentdex. Search by title, directory, or ID, or filter by provider. Results are sorted by last update and include archived sessions. The list refreshes every 15 seconds while the tab is visible; **Refresh** fetches it immediately. Discovery errors are shown per provider without hiding other providers' history or the managed terminal.

Codex discovery uses the [official app-server thread listing protocol](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters), reading every page for both archived and non-archived threads, across supported sources and model providers. It uses the CLI's existing `CODEX_HOME` and configuration. Listing does not resume threads or start model turns. Rows show **Saved** or **Archived** plus **Active**, **No activity detected**, or **Status unknown**. On Linux, Codex writer locks under the configured `CODEX_HOME` and Antigravity presence locks under the history database directory are matched to held kernel locks; stale files alone do not establish activity. Other platforms or failed inspection report unknown. OpenCode activity describes the service reached by `OPENCODE_BIN` via `/api/session/active`. Existing refresh and polling update these labels. Known-active sessions and descendants are blocked from deletion with HTTP 409; close them in the provider before retrying. Native provider deletion safeguards remain in effect.

OpenCode discovery calls the installed v2 CLI's [global session API](https://opencode.ai/v2/docs/api), following every cursor for both saved and archived sessions. It includes child sessions across projects rather than using the project-scoped `session list` command. The CLI connects to its usual local service and handles its authentication.

Antigravity CLI discovery reads `~/.gemini/antigravity-cli/conversation_summaries.db` in read-only mode. It lists indexed conversations across workspaces without reading transcripts or credentials. Missing history returns an empty list; inaccessible or incompatible databases produce a provider-specific error. The index supplies last-modified time but no creation timestamp or archive flag, so `createdAt` is `null` and these entries are shown as saved. This storage format is version-dependent and may need adapter updates after CLI upgrades. Managed Antigravity terminals use OSC 7501 task reports (AGY 1.4.0+) for tab activity and matching saved-session sidebar filters. Sessions opened outside Agentdex still use presence locks, which indicate an open session rather than a working task.

Multiple managed terminals can run concurrently, including several from the same provider. Each new session opens its own tab; **All sessions** shows native saved history. Switching tabs or refreshing the browser preserves the running processes and restores terminal screen state and bounded scrollback when reconnecting. Closing the browser leaves the CLIs running. **Stop session** terminates only the process in that session tab; other sessions continue running. Exited tabs remain available for reviewing output until the backend restarts.

Managed terminals live in backend memory. Stopping or restarting the backend ends the running process and clears its terminal state; provider history remains available. Sessions launched outside Agentdex are listed but their terminals cannot be attached. Agentdex has no separate session database or detached runner.

Both servers bind to loopback. API mutations and terminal connections require a local HttpOnly session cookie; requests with unknown hosts or origins are rejected. No provider credentials are sent to the browser.

## Library names and storage

The library lives under `~/.local/share/agentdex/`. Skills use the frontmatter name from `SKILL.md` under `skills/<skill-name>/`. MCP definitions live at `mcps/<original-name>/definition.json`, with secret-free launcher snapshots in the same folder. MCP provider keys use the original name; JSON imports preserve the `mcpServers` key. Changing a display label does not rename storage or provider entries. Unsafe and duplicate names are rejected without automatic prefixes or suffixes.

Saving or syncing migrates legacy MCP definition files. The next explicit Sync of each destination renames an owned generated provider key to its original name, preserving credentials and provider metadata. Unmanaged entries, external edits, and naming conflicts are preserved and reported.

## MCP credentials

Create or edit MCPs on `/mcps` using the form or JSON, select providers, then click **Sync**. Agentdex saves credential names and masked placeholders in its library; actual environment/header values entered in the form are held in server memory until a successful Sync. Sync writes those values directly into the selected providers' native configuration files with owner-only permissions. Unsynced values are lost if the server restarts; enter them again if needed. Saving a definition does not update providers.

Later Sync operations recover static credentials from Agentdex-owned provider entries, including after a restart. If providers contain different values, choose a **Credential source** or enter replacement values. Unmanaged or structurally modified entries cannot supply credentials. Environment/file references are not resolved or copied as tokens. OAuth login, credential stores, and refresh remain provider-managed.

Provider files can contain plaintext API tokens; Agentdex does not encrypt them. Its catalog, definition files, and new launcher snapshots contain no environment/header credential values. A secret-free launcher is used only when OpenCode needs a working directory; credentials are supplied by OpenCode's native environment configuration. Existing installations from older Agentdex versions are marked for migration: explicitly Sync each installed destination to move its credentials into native configuration and remove its old secret-bearing snapshot. Conflicts preserve the existing installation and require resolution before cleanup.

## Local API

- `GET /api/health`: server health.
- `GET /api/providers`: registered provider IDs and display names, plus the default provider ID.
- `GET /api/sessions`: saved `sessions` aggregated from provider adapters, per-provider `discoveryErrors`, all `managedSessions`, the latest managed `session` for compatibility, and the default working directory; establishes the local access cookie.
- `POST /api/sessions`: launch a registered provider with `{ "provider": "codex", "workingDirectory": "/absolute/path" }`. Omitting `provider` defaults to Codex; invalid or unknown provider IDs return HTTP 400.
- `DELETE /api/sessions/:id`: stop a session.
- `WS /api/sessions/:id/terminal`: terminal snapshot, output, exit, input, and resize events.

Integration tests launch a real PTY with deterministic provider fixtures to cover provider discovery and selection, arguments and environment overrides, default-provider compatibility, directory validation, concurrent launches, terminal input, resizing, reconnect replay, exit/relaunch, stopping, provider-specific executable errors, and access controls.

Saved sessions can be permanently deleted from each history row after confirmation, including child sessions. Codex uses native app-server `thread/delete`; OpenCode uses `session delete <id>` with `OPENCODE_BIN` when configured. Stop all of the provider's running Agentdex terminals before deleting.

Antigravity deletion is **local-only** and requires confirmation that external Antigravity sessions are stopped. Presence-file existence and persisted status alone do not establish activity; held locks do. Cleanup uses the directory containing `AGY_HISTORY_DB`, or `~/.gemini/antigravity-cli` by default. It removes the conversation and descendants' databases and sidecars, brain folders, annotations, presence locks, implicit files, and matching entries in `cache/last_conversations.json` and `cache/conversation_metadata.json`, then summary records. Workspace files, cloud copies, shared logs, and knowledge are outside scope. Symlinked targets and unsupported cache/database formats are rejected. If cleanup partially fails, summary records remain available so deletion can be retried after resolving the reported problem.

## Custom Agents

Open `/agents` to create a specialist using the form or paste Markdown with `name` and `description` frontmatter and instructions in the body. Only these frontmatter fields are supported; other settings are rejected. Original names must be lowercase and hyphenated, are immutable, and are never automatically renamed. Display labels can change independently.

Canonical Markdown lives at `~/.local/share/agentdex/agents/<original-name>/agent.md`. Saving changes only the library. Select destinations and click **Sync** to publish regular global agent files:

- [Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents): `$CODEX_HOME/agents/<name>.toml` (defaults to `~/.codex`). Ask Codex to delegate to the named specialist.
- [Antigravity](https://www.agy.dev/docs/subagents?tab=cli): `~/.gemini/config/agents/<name>.md`, with `subagent: true` and `mainAgent: false`. Ask the parent agent to invoke the named subagent.
- [OpenCode v2](https://dev.opencode.ai/v2/docs/agents/): `$XDG_CONFIG_HOME/opencode/agents/<name>.md` (defaults to `~/.config`), with `mode: subagent`. Ask the primary agent to use the named subagent.

Provider reload or restart may be needed after Sync or Uninstall. Model, tools, permissions, MCP settings, and execution policy remain controlled by provider defaults. Session launching is unchanged. Agentdex reports outdated publications after instruction edits and conflicts for built-in names, competing global definitions, unmanaged files, symlinks, or external edits. Uninstall and Delete remove only publications whose stored ownership fingerprints still match; resolve conflicts before retrying. Project installations, native-format imports, advanced settings, and a launch selector are deferred.

Agents use the library API conventions: `GET/POST /api/agents`, `PUT/DELETE /api/agents/:id`, and `POST /api/agents/:id/sync` or `/uninstall` with a `destinations` array. Creation and updates accept a display `name` plus either `agent: { name, description, instructions }` or canonical Markdown `content`.
