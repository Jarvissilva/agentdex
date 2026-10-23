# Agentdex

A local interface for coding agent sessions. Launch Codex, Antigravity CLI, or OpenCode in a working directory and use its native terminal directly in your browser.

## Development

Requires Node.js 22.12+, pnpm 10.22.0, and the CLIs you want to use installed and authenticated (`codex`, `agy`, OpenCode v2's `opencode`). Installing `node-pty` may require Python, make, and a C++ compiler on Linux. Antigravity history uses Node's built-in SQLite reader; Node 22 may emit an experimental-feature notice.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/sessions`, choose a provider, enter a working directory, and click **Launch session**. `~` and `~/path` are supported. Each CLI uses your existing configuration and authentication. Native prompts and approvals appear in the embedded terminal.

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

`apps/server/src/lib/providers` is the bridge between providers and session execution. Each adapter defines an ID, display name, installation guidance, `listSessions()` for native saved history, and `getLaunchConfig(workingDirectory)` returning an executable, argument array, and optional environment overrides. Codex owns its `CODEX_BIN` setting in `codex.ts`; executable availability is checked when launching.

To add a provider, create its adapter and register it in `lib/providers/index.ts`. Session routes, controllers, terminal transport, and client selector do not need provider-specific changes. The selector reads public metadata from `/api/providers`; executable configuration and environment values stay on the server. Codex, Antigravity CLI, and OpenCode are registered, with Codex as the default.

## Session behavior

The sessions page lists saved history from every registered provider, including sessions started outside Agentdex. Search by title, directory, or ID, or filter by provider. Results are sorted by last update and include archived sessions. The list refreshes every 15 seconds while the tab is visible; **Refresh** fetches it immediately. Discovery errors are shown per provider without hiding other providers' history or the managed terminal.

Codex discovery uses the [official app-server thread listing protocol](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters), reading every page for both archived and non-archived threads, across supported sources and model providers. It uses the CLI's existing `CODEX_HOME` and configuration. Listing does not resume threads or start model turns. Saved metadata cannot reliably establish whether an outside session is currently running, so rows are labelled **Saved** or **Archived**.

OpenCode discovery calls the installed v2 CLI's [global session API](https://opencode.ai/v2/docs/api), following every cursor for both saved and archived sessions. It includes child sessions across projects rather than using the project-scoped `session list` command. The CLI connects to its usual local service and handles its authentication.

Antigravity CLI discovery reads `~/.gemini/antigravity-cli/conversation_summaries.db` in read-only mode. It lists indexed conversations across workspaces without reading transcripts or credentials. Missing history returns an empty list; inaccessible or incompatible databases produce a provider-specific error. The index supplies last-modified time but no creation timestamp or archive flag, so `createdAt` is `null` and these entries are shown as saved. This storage format is version-dependent and may need adapter updates after CLI upgrades.

One active managed terminal is supported across providers. Browser refreshes reconnect to that session and restore terminal screen state and bounded scrollback. Closing a tab leaves the CLI running. **Stop session** terminates the process; after exit you can launch another session from any registered provider.

Managed terminals live in backend memory. Stopping or restarting the backend ends the running process and clears its terminal state; provider history remains available. Sessions launched outside Agentdex are listed but their terminals cannot be attached. Agentdex has no separate database, detached runner, or provider configuration management yet.

Both servers bind to loopback. API mutations and terminal connections require a local HttpOnly session cookie; requests with unknown hosts or origins are rejected. No provider credentials are sent to the browser.

## Local API

- `GET /api/health`: server health.
- `GET /api/providers`: registered provider IDs and display names, plus the default provider ID.
- `GET /api/sessions`: saved `sessions` aggregated from provider adapters, per-provider `discoveryErrors`, the current managed `session`, and the default working directory; establishes the local access cookie.
- `POST /api/sessions`: launch a registered provider with `{ "provider": "codex", "workingDirectory": "/absolute/path" }`. Omitting `provider` defaults to Codex; invalid or unknown provider IDs return HTTP 400.
- `DELETE /api/sessions/:id`: stop a session.
- `WS /api/sessions/:id/terminal`: terminal snapshot, output, exit, input, and resize events.

Integration tests launch a real PTY with deterministic provider fixtures to cover provider discovery and selection, arguments and environment overrides, default-provider compatibility, directory validation, concurrent launches, terminal input, resizing, reconnect replay, exit/relaunch, stopping, provider-specific executable errors, and access controls.
