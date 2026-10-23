import { lazy, Suspense, useCallback, useEffect } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import { data, Form, useActionData, useLoaderData, useNavigation, useRevalidator, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import type { CreateSessionRequest, ProvidersResponse, Session, SessionsResponse } from '@agentdex/shared';
import { Button } from '@/components/ui/shadcn/button';
import { api, ApiRequestError } from '@/lib/api';
import SessionList from '@/components/sessions/SessionList';

const SessionTerminal = lazy(() => import('@/components/sessions/SessionTerminal'));

export async function sessionsLoader({ request }: LoaderFunctionArgs) {
  const [sessions, providers] = await Promise.all([
    api<SessionsResponse>('/sessions', { signal: request.signal }),
    api<ProvidersResponse>('/providers', { signal: request.signal }),
  ]);
  return { ...sessions, ...providers };
}

export async function sessionsAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    if (form.get('intent') === 'stop') {
      const id = form.get('sessionId');
      if (typeof id !== 'string' || !id) return data({ error: 'Missing session ID.' }, { status: 400 });
      await api(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', signal: request.signal });
    } else if (form.get('intent') === 'launch') {
      const provider = form.get('provider');
      const workingDirectory = form.get('workingDirectory');
      if (typeof provider !== 'string' || typeof workingDirectory !== 'string') {
        return data({ error: 'Select a provider and enter a working directory.' }, { status: 400 });
      }
      const input: CreateSessionRequest = { provider, workingDirectory };
      await api<Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: request.signal,
      });
    } else return data({ error: 'Unknown session action.' }, { status: 400 });
    return { error: null };
  } catch (error) {
    if (error instanceof ApiRequestError) return data({ error: error.message }, { status: error.status });
    throw error;
  }
}

export default function Sessions() {
  const { session, sessions, discoveryErrors, defaultWorkingDirectory, providers, defaultProviderId } = useLoaderData<typeof sessionsLoader>();
  const actionData = useActionData<typeof sessionsAction>();
  const navigation = useNavigation();
  const { revalidate, state: refreshState } = useRevalidator();
  const onExit = useCallback(() => { void revalidate(); }, [revalidate]);
  const running = session?.status === 'running';
  const pending = navigation.state !== 'idle';
  const providerName = providers.find((provider) => provider.id === session?.provider)?.name ?? session?.provider ?? 'Session';

  useEffect(() => {
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void revalidate(); }, 15000);
    return () => clearInterval(interval);
  }, [revalidate]);

  return (
    <>
      <title>Sessions · Agentdex</title>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5 lg:px-10">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sessions across your configured providers.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => { void revalidate(); }} disabled={refreshState !== 'idle' || pending}>
            <RefreshCw aria-hidden="true" />{refreshState === 'idle' ? 'Refresh' : 'Refreshing…'}
          </Button>
          {running && (
            <Form method="post">
              <input type="hidden" name="sessionId" value={session.id} />
              <Button type="submit" name="intent" value="stop" variant="outline" disabled={pending}>
                <Square aria-hidden="true" />Stop session
              </Button>
            </Form>
          )}
        </div>
      </header>
      <div className="space-y-6 px-6 py-6 lg:px-10">
        {actionData?.error && <p role="alert" className="text-sm text-destructive">{actionData.error}</p>}
        {discoveryErrors.map((issue) => <p key={issue.provider} role="alert" className="text-sm text-destructive">{providers.find((provider) => provider.id === issue.provider)?.name ?? issue.provider}: {issue.error}</p>)}
        {!running && (
          <Form method="post" className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
            <div className="space-y-2">
              <label htmlFor="provider" className="block text-xs font-medium text-muted-foreground">Provider</label>
              <select id="provider" name="provider" className="h-9 rounded-md border border-input bg-background px-3 text-sm" defaultValue={session?.provider ?? defaultProviderId}>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </div>
            <div className="min-w-0 flex-1 basis-64 space-y-2">
              <label htmlFor="workingDirectory" className="block text-xs font-medium text-muted-foreground">Working directory</label>
              <input id="workingDirectory" name="workingDirectory" defaultValue={session?.workingDirectory ?? defaultWorkingDirectory} placeholder="/absolute/path/to/project" required spellCheck={false} autoComplete="off" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <Button type="submit" name="intent" value="launch" disabled={pending}>
              <Play aria-hidden="true" />{pending ? 'Launching…' : 'Launch session'}
            </Button>
          </Form>
        )}
        <SessionList sessions={sessions} providers={providers} />
        {session && (
          <section aria-label="Current session" className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{providerName}</span>
              <span>{running ? 'Running' : `Exited · code ${session.exitCode ?? 'unknown'}`}</span>
              <span className="min-w-0 break-all font-mono">{session.workingDirectory}</span>
            </div>
            <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading terminal…</p>}>
              <SessionTerminal key={session.id} sessionId={session.id} providerName={providerName} onExit={onExit} />
            </Suspense>
          </section>
        )}
      </div>
    </>
  );
}
