import { Plus, TerminalSquare } from 'lucide-react';
import { data, Form, useActionData, useLoaderData } from 'react-router';
import { Button } from '@/components/ui/shadcn/button';

export function sessionsLoader() {
  return { canLaunch: false };
}

export function sessionsAction() {
  // Keep unsupported mutations explicit until the terminal backend is connected.
  return data(
    { error: 'Session launching is not connected yet.' },
    { status: 501 },
  );
}

export default function Sessions() {
  const { canLaunch } = useLoaderData<typeof sessionsLoader>();
  const actionData = useActionData<typeof sessionsAction>();

  return (
    <>
      <title>Sessions · Agentdex</title>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5 lg:px-10">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your coding agents, in one workspace.</p>
        </div>
        <Form method="post">
          <Button type="submit" disabled={!canLaunch} aria-describedby="session-launch-status">
            <Plus aria-hidden="true" />
            New session
          </Button>
        </Form>
      </header>
      <div className="px-6 py-8 lg:px-10">
        {actionData?.error && <p role="alert" className="mb-4 text-sm text-destructive">{actionData.error}</p>}
        <section aria-labelledby="empty-sessions-title" className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-card">
            <TerminalSquare className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <h2 id="empty-sessions-title" className="text-sm font-medium">No sessions yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Your Codex terminal sessions will appear here.</p>
          <p id="session-launch-status" className="mt-5 text-xs text-muted-foreground">Session launching will be connected next.</p>
        </section>
      </div>
    </>
  );
}
