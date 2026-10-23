# Agentdex

A local interface for coding agent sessions. This initial scaffold provides the application shell and `/sessions` placeholder; terminal launching is not connected yet.

## Development

Requires Node.js 22.12+ and pnpm 10.22.0.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. `/` redirects to `/sessions`.

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm preview
```

## Structure

- `apps/client`: Vite, React, TypeScript, Tailwind CSS, shadcn/ui, and React Router data mode.
- `src/router.tsx`: route configuration, redirects, loaders, actions, and error boundaries.
- `src/pages`: page components with named route loaders/actions, following the Wizyz reference.
- `src/layouts`: application layout; `src/components/layout`: sidebar.
- `src/components/ui/shadcn`: shadcn components; `src/lib`: shared frontend utilities.

The sessions action deliberately returns HTTP 501 until launching is implemented; its submit button remains disabled. Future reads and mutations should use route loaders and actions rather than component effects and submit handlers.

Add `apps/server` for the Express terminal backend when needed, separating routes, controllers, services, and models. Introduce shared workspace packages only when there is code to share. SPA hosting must fall back to `index.html` for browser routes such as `/sessions`.
