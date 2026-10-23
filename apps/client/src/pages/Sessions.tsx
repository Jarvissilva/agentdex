import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ListFilter, Search, Plus, RefreshCw, Square, X, Command } from 'lucide-react';
import { data, Form, Link, useActionData, useLoaderData, useNavigation, useOutletContext, useRevalidator, useSearchParams, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import type { CreateSessionRequest, ManagedSessionsResponse, ProvidersResponse, ProviderSession, Session, SessionsResponse } from '@agentdex/shared';
import { Button } from '@/components/ui/shadcn/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { api, ApiRequestError } from '@/lib/api';
import SessionExplorer from '@/components/sessions/SessionExplorer';
import type { WorkspaceContext } from '@/layouts/AppLayout';
import SessionList from '@/components/sessions/SessionList';
import NewSessionDialog from '@/components/sessions/NewSessionDialog';
import { sessionActivity, type SessionStatusFilter } from '@/lib/sessionActivity';
import { Popover, Tabs } from 'radix-ui';

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
      if (typeof id !== 'string' || !id) return data({ error: 'Missing session ID.', sessionId: null }, { status: 400 });
      await api(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', signal: request.signal });
    } else if (form.get('intent') === 'launch') {
      const provider = form.get('provider');
      const workingDirectory = form.get('workingDirectory');
      if (typeof provider !== 'string' || typeof workingDirectory !== 'string') {
        return data({ error: 'Select a provider and enter a working directory.', sessionId: null }, { status: 400 });
      }
      const input: CreateSessionRequest = { provider, workingDirectory };
      const created = await api<Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: request.signal,
      });
      return { error: null, sessionId: created.id };
    } else return data({ error: 'Unknown session action.', sessionId: null }, { status: 400 });
    return { error: null, sessionId: null };
  } catch (error) {
    if (error instanceof ApiRequestError) return data({ error: error.message, sessionId: null }, { status: error.status });
    throw error;
  }
}

export default function Sessions() {
  const { managedSessions: loadedManagedSessions, sessions, discoveryErrors, defaultWorkingDirectory, homeDirectory, providers, defaultProviderId } = useLoaderData<typeof sessionsLoader>();
  const [managedUpdate, setManagedUpdate] = useState<{ source: Session[]; sessions: Session[] } | null>(null);
  const managedSessions = managedUpdate?.source === loadedManagedSessions ? managedUpdate.sessions : loadedManagedSessions;
  const actionData = useActionData<typeof sessionsAction>();
  const navigation = useNavigation();
  const { revalidate, state: refreshState } = useRevalidator();
  const onExit = useCallback(() => { void revalidate(); }, [revalidate]);
  const [dateRange, setDateRange] = useState('today');
  const dateOptions = [{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7days', label: 'Last 7 days' }, { value: '30days', label: 'Last 30 days' }, { value: 'all', label: 'All time' }];
  const [activity, setActivity] = useState<SessionStatusFilter>('active');
  const statusOptions = [{ value: 'active', label: 'Running' }, { value: 'needs-input', label: 'Needs input' }, { value: 'inactive', label: 'Ready' }, { value: 'all', label: 'All' }] as const;
  const [provider, setProvider] = useState('all');
  const [search, setSearch] = useState('');
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  const visibleSessions = managedSessions.filter((session) => !closedTabs.includes(session.id));
  const [activeTab, setActiveTab] = useState(managedSessions.at(-1)?.id ?? '');
  const workspace = useOutletContext<WorkspaceContext>();
  const { closeMobileExplorer } = workspace;
  const [openingSession, setOpeningSession] = useState<ProviderSession | null>(null);
  const [openError, setOpenError] = useState<{ provider: string; id: string; message: string } | null>(null);
  const opening = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const selectedSession = managedSessions.find((session) => session.id === activeTab);
  function closeTab(id: string) {
    const index = visibleSessions.findIndex((session) => session.id === id);
    setClosedTabs((closed) => [...closed, id]);
    if (activeTab === id) setActiveTab(visibleSessions[index + 1]?.id ?? visibleSessions[index - 1]?.id ?? '');
  }

  const onCreated = useCallback((id: string) => { setActiveTab(id); setCreating(false); closeMobileExplorer(); }, [closeMobileExplorer, setActiveTab, setCreating]);
  const directories = [...new Set([defaultWorkingDirectory, ...managedSessions.map((session) => session.workingDirectory), ...sessions.map((session) => session.workingDirectory)].filter(Boolean))];
  const pending = navigation.state !== 'idle';

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      try {
        const result = await api<ManagedSessionsResponse>('/sessions/managed', { signal: controller.signal });
        if (!controller.signal.aborted) setManagedUpdate({ source: loadedManagedSessions, sessions: result.managedSessions });
      } catch { /* Keep the last known state until the next successful poll. */ }
      finally { pending = false; }
    };
    const interval = setInterval(() => { void refresh(); }, 2000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [loadedManagedSessions]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && refreshState === 'idle') void revalidate();
    };
    const interval = setInterval(refresh, 3000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [revalidate, refreshState]);

  function selectTerminal(id: string) {
    setClosedTabs((closed) => closed.filter((closedId) => closedId !== id));
    setActiveTab(id);
    setOpenError(null);
    closeMobileExplorer();
  }

  async function openSession(saved: ProviderSession) {
    if (opening.current) return;
    setOpenError(null);
    const existing = managedSessions.find((entry) => entry.provider === saved.provider && entry.providerSessionId === saved.id && entry.status === 'running');
    if (existing) {
      setClosedTabs((closed) => closed.filter((id) => id !== existing.id));
      setActiveTab(existing.id);
      closeMobileExplorer();
      return;
    }
    opening.current = true;
    setOpeningSession(saved);
    try {
      const input: CreateSessionRequest = { provider: saved.provider, workingDirectory: saved.workingDirectory, resumeSessionId: saved.id };
      const created = await api<Session>('/sessions', { method: 'POST', body: JSON.stringify(input) });
      await revalidate();
      setClosedTabs((closed) => closed.filter((id) => id !== created.id));
      setActiveTab(created.id);
      closeMobileExplorer();
    } catch (error) {
      setOpenError({ ...saved, message: error instanceof Error ? error.message : 'Unable to resume this session. Retry.' });
      if (error instanceof ApiRequestError && [404, 409].includes(error.status)) void revalidate();
    } finally {
      opening.current = false;
      setOpeningSession(null);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <title>Sessions · Agentdex</title>
      <SessionExplorer {...workspace}>
        <div className="mb-3 flex items-center justify-between gap-2 px-3">
          <h1 className="min-w-0 truncate text-xs font-medium uppercase tracking-wider">Sessions</h1>
          <div className="flex items-center gap-1">
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Search sessions" title="Search sessions" className={search ? 'text-blue-400' : ''}><Search aria-hidden="true" /></Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={4} className="z-50 w-64 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
                  <input aria-label="Search sessions" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sessions…" className="h-8 w-full min-w-0 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Filter sessions" title="Filter sessions" className={provider !== 'all' || dateRange !== 'today' || activity !== 'active' ? 'text-blue-400' : ''}><ListFilter aria-hidden="true" /></Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={4} className="z-50 w-56 space-y-3 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
                  <div className="space-y-1.5">
                    <label htmlFor="session-status-filter" className="text-xs font-medium">Status</label>
                    <Select value={activity} onValueChange={(value) => {
                      const option = statusOptions.find((entry) => entry.value === value);
                      if (option) setActivity(option.value);
                    }}>
                      <SelectTrigger id="session-status-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>{statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="session-date-filter" className="text-xs font-medium">Date</label>
                    <Select value={dateRange} onValueChange={setDateRange}>
                      <SelectTrigger id="session-date-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>{dateOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="session-provider-filter" className="text-xs font-medium">Provider</label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="session-provider-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All providers</SelectItem>
                        {providers.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Refresh sessions" title="Refresh sessions" onClick={() => { void revalidate(); }} disabled={refreshState !== 'idle' || pending}><RefreshCw className={refreshState === 'idle' ? '' : 'animate-spin'} aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="New session" title="New session" onClick={() => setCreating(true)}><Plus aria-hidden="true" /></Button>
          </div>
        </div>
        {discoveryErrors.map((issue) => <p key={issue.provider} role="alert" className="px-3 pb-3 text-xs text-destructive">{providers.find((provider) => provider.id === issue.provider)?.name ?? issue.provider}: {issue.error}</p>)}
        <SessionList selectedTerminalId={activeTab} onSelectTerminal={selectTerminal} homeDirectory={homeDirectory} activity={activity} onActivityChange={setActivity} search={search} provider={provider} dateRange={dateRange} managedSessions={managedSessions} sessions={sessions} providers={providers} selectedSession={selectedSession?.providerSessionId ? { provider: selectedSession.provider, id: selectedSession.providerSessionId } : undefined} openingSession={openingSession} openError={openError} onOpen={(session) => { void openSession(session); }} />
      </SessionExplorer>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {actionData?.error && <p role="alert" className="p-3 text-sm text-destructive">{actionData.error}</p>}
        <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-w-0 shrink-0 items-center border-b border-border bg-sidebar">
            <Link to="/" aria-label="Home" title="Home" className="flex shrink-0 items-center justify-center self-stretch border-r border-border px-3 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <Command className="size-4" aria-hidden="true" />
            </Link>
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            <Tabs.List aria-label="Session tabs" className="flex shrink-0 items-center">
              {visibleSessions.map((session) => {
                const name = providers.find((provider) => provider.id === session.provider)?.name ?? session.provider;
                const directory = session.workingDirectory.split('/').filter(Boolean).at(-1) ?? '/';
                const saved = sessions.find((entry) => entry.provider === session.provider && entry.id === session.providerSessionId);
                return <div key={session.id} className={`flex shrink-0 items-center border-r border-t-2 border-border ${activeTab === session.id ? 'border-t-blue-400 bg-background' : 'border-t-transparent hover:bg-accent'}`}>
                  <Tabs.Trigger value={session.id} title={`${name} · ${session.workingDirectory} · ${saved?.title ?? session.id}`} className="flex h-9.5 max-w-64 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:text-foreground">
                    <span aria-label={sessionActivity(session).label} className={`size-1.5 shrink-0 rounded-full ${sessionActivity(session).needsInput ? 'bg-amber-400' : sessionActivity(session).running ? 'bg-emerald-400' : session.status === 'running' && session.taskActivity === 'not-running' ? 'bg-blue-400' : 'bg-muted-foreground'}`} />
                    <span className="truncate">{name} · {saved?.title ?? directory}</span>
                  </Tabs.Trigger>
                  <button type="button" aria-label={`Close ${name} · ${saved?.title ?? directory} tab`} title="Close tab" onClick={() => closeTab(session.id)} className="mr-1 rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </div>;
              })}
            </Tabs.List>
            <Button type="button" variant="ghost" size="icon" aria-label="New session" title="New session" onClick={() => setCreating(true)}><Plus aria-hidden="true" /></Button>
            </div>
            {selectedSession?.status === 'running' && <Form method="post" className="shrink-0 border-l border-border">
              <input type="hidden" name="sessionId" value={selectedSession.id} />
              <Button type="submit" name="intent" value="stop" variant="ghost" size="icon" disabled={pending} aria-label="Stop session" title="Stop session"><Square aria-hidden="true" /></Button>
            </Form>}
          </div>
          {!selectedSession && <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <h2 className="text-lg font-medium">Your coding workspace</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Open a saved session from the explorer to continue, or start a new session.</p>
            <Button type="button" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New session</Button>
            <Button type="button" variant="ghost" onClick={workspace.toggleExplorer}>Toggle sessions explorer</Button>
          </div>}
          {visibleSessions.map((session) => {
            const providerName = providers.find((provider) => provider.id === session.provider)?.name ?? session.provider;
            return (
              <Tabs.Content key={session.id} value={session.id} className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading terminal…</p>}>
                  <SessionTerminal
                    sessionId={session.id}
                    providerId={session.provider}
                    providerName={providerName}
                    onExit={onExit}
                  />
                </Suspense>
              </Tabs.Content>
            );
          })}
        </Tabs.Root>
      </div>
      {creating && <NewSessionDialog providers={providers} defaultProviderId={selectedSession?.provider ?? defaultProviderId} defaultWorkingDirectory={selectedSession?.workingDirectory ?? defaultWorkingDirectory} directories={directories} onClose={() => setCreating(false)} onCreated={onCreated} />}
    </div>
  );
}
