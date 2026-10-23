import WorkspaceTabBar from '@/components/workspace/WorkspaceTabBar';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Square, X } from 'lucide-react';
import { useLoaderData, useSearchParams } from 'react-router';
import type { LibraryItem, LibraryKind, LibraryResponse, CreateSessionRequest, ManagedSessionsResponse, ProvidersResponse, ProviderSession, Session, SessionsResponse } from '@agentdex/shared';
import { Button } from '@/components/ui/shadcn/button';
import { initialPanel, findEditorTab, adjacentTab, type WorkspacePanel, type EditorTab, type WorkspaceTab } from '@/lib/workspace';
import { api, ApiRequestError } from '@/lib/api';
import SessionExplorer from '@/components/sessions/SessionExplorer';
import AppLayout, { type WorkspaceContext } from '@/layouts/AppLayout';
import SessionsPanel from '@/pages/SessionsPanel';
import { sessionsLoader } from '@/pages/Sessions';
import NewSessionDialog from '@/components/sessions/NewSessionDialog';
import { sessionActivity } from '@/lib/sessionActivity';
import { Tabs } from 'radix-ui';

const libraryPanels = {
  skills: lazy(() => import('@/pages/Library').then(module => ({ default: module.SkillsPanel }))),
  agents: lazy(() => import('@/pages/Library').then(module => ({ default: module.AgentsPanel }))),
  mcps: lazy(() => import('@/pages/Library').then(module => ({ default: module.McpsPanel }))),
};
const LibraryEditor = lazy(() => import('@/pages/LibraryEditor'));
const SettingsPanel = lazy(() => import('@/pages/Settings'));

const SessionTerminal = lazy(() => import('@/components/sessions/SessionTerminal'));

export default function Workspace() {
  const [panel, setPanel] = useState(() => initialPanel(window.location.search));
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(() => initialPanel(window.location.search) !== 'sessions');
  const selectPanel = (next: WorkspacePanel) => { if (next === panel) { toggleExplorer(); return; } setPanel(next); if (window.matchMedia('(min-width: 768px)').matches) setExplorerOpen(true); else setMobileExplorerOpen(true); };

  const toggleExplorer = useCallback(() => {
    if (window.matchMedia('(min-width: 768px)').matches) setExplorerOpen((open) => !open);
    else setMobileExplorerOpen((open) => !open);
  }, []);
  const closeMobileExplorer = useCallback(() => setMobileExplorerOpen(false), []);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setDesktop(media.matches);
      if (media.matches) setMobileExplorerOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const workspace: WorkspaceContext = { panel, selectPanel, desktop, explorerOpen, mobileExplorerOpen, closeMobileExplorer, toggleExplorer };

  const initialData = useLoaderData<typeof sessionsLoader>();
  const [sessionData, setSessionData] = useState(initialData);
  const { managedSessions: loadedManagedSessions, sessions, discoveryErrors, defaultWorkingDirectory, homeDirectory, providers, defaultProviderId } = sessionData;
  const [refreshState, setRefreshState] = useState<'idle' | 'loading'>('idle');
  const [refreshError, setRefreshError] = useState('');
  const revalidate = useCallback(async () => {
    setRefreshState('loading');
    try { const [sessions, providers] = await Promise.all([api<SessionsResponse>('/sessions'), api<ProvidersResponse>('/providers')]); setSessionData({ ...sessions, ...providers }); setRefreshError(''); }
    catch (error) { setRefreshError(error instanceof Error ? error.message : 'Unable to refresh sessions.'); }
    finally { setRefreshState('idle'); }
  }, []);
  useEffect(() => {
    const refresh = () => { void revalidate(); };
    window.addEventListener('agentdex-settings', refresh);
    window.addEventListener('agentdex-memory-cleared', refresh);
    return () => { window.removeEventListener('agentdex-settings', refresh); window.removeEventListener('agentdex-memory-cleared', refresh); };
  }, [revalidate]);
  const [managedUpdate, setManagedUpdate] = useState<{ source: Session[]; sessions: Session[] } | null>(null);
  const managedSessions = managedUpdate?.source === loadedManagedSessions ? managedUpdate.sessions : loadedManagedSessions;
  const [stopError, setStopError] = useState('');
  const [stopping, setStopping] = useState(false);
  const onExit = useCallback(() => { void revalidate(); }, [revalidate]);
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  const visibleSessions = managedSessions.filter((session) => !closedTabs.includes(session.id));
  const [requestedTab, setActiveTab] = useState(managedSessions.at(-1)?.id ?? '');
  const activeTab = requestedTab;
  const [editors, setEditors] = useState<EditorTab[]>([]);
  const [libraries, setLibraries] = useState<Partial<Record<LibraryKind, LibraryItem[]>>>({});
  const [visited, setVisited] = useState<string[]>([]);
  const [libraryError, setLibraryError] = useState<{ kind: LibraryKind; message: string } | null>(null);
  const panelActive = (workspace.desktop ? workspace.explorerOpen : workspace.mobileExplorerOpen);
  const refreshLibrary = useCallback(async (kind: LibraryKind) => {
    const result = await api<LibraryResponse>(`/${kind}`);
    setLibraries(previous => ({ ...previous, [kind]: result.items }));
  }, []);
  if (panelActive && !visited.includes(workspace.panel)) setVisited(previous => [...previous, workspace.panel]);
  useEffect(() => {
    if (!panelActive) return;
    const kind = workspace.panel;
    const timer = setTimeout(() => {
      if (['skills', 'agents', 'mcps'].includes(kind) && !libraries[kind as LibraryKind]) {
        void refreshLibrary(kind as LibraryKind).catch(error => setLibraryError({ kind: kind as LibraryKind, message: error instanceof Error ? error.message : 'Unable to load library.' }));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [workspace.panel, panelActive, libraries, refreshLibrary]);
  const dirty = editors.some(tab => tab.dirty);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function openEditor(kind: LibraryKind, item: LibraryItem | 'new') {
    const existing = findEditorTab(editors, kind, item);
    const key = existing?.key ?? `editor:${crypto.randomUUID()}`;
    if (!existing) setEditors(previous => [...previous, { type: 'editor', key, kind, item, dirty: false }]);
    setActiveTab(key); workspace.closeMobileExplorer();
  }
  const tabs: WorkspaceTab[] = [...visibleSessions.map(session => ({ type: 'terminal' as const, key: session.id })), ...editors];
  const [openingSession, setOpeningSession] = useState<ProviderSession | null>(null);
  const [openError, setOpenError] = useState<{ provider: string; id: string; message: string } | null>(null);
  const opening = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');
  useEffect(() => {
    if (!searchParams.has('new') && !searchParams.has('panel')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.delete('panel');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const selectedSession = managedSessions.find((session) => session.id === activeTab);
  function closeTab(id: string) {
    const editor = editors.find(tab => tab.key === id);
    if (editor?.dirty && !window.confirm('Discard unsaved changes?')) return;
    setEditors(previous => previous.filter(tab => tab.key !== id));
    setClosedTabs((closed) => [...closed, id]);
    if (activeTab === id) setActiveTab(adjacentTab(tabs, id));
  }

  const onCreated = useCallback((id: string) => { void revalidate(); setActiveTab(id); setCreating(false); closeMobileExplorer(); }, [closeMobileExplorer, setActiveTab, setCreating, revalidate]);
  const directories = [...new Set([defaultWorkingDirectory, ...managedSessions.map((session) => session.workingDirectory), ...sessions.map((session) => session.workingDirectory)].filter(Boolean))];
  const pending = stopping;

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
      if (panelActive && workspace.panel === 'sessions' && document.visibilityState === 'visible' && refreshState === 'idle') void revalidate();
    };
    const interval = setInterval(refresh, 3000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [revalidate, refreshState, panelActive, workspace.panel]);

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
    <AppLayout workspace={workspace}>
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <title>Agentdex</title>
      <SessionExplorer {...workspace}>
        <div hidden={workspace.panel !== 'sessions'} className="h-full">
        <SessionsPanel discoveryErrors={discoveryErrors} refreshError={refreshError} refreshState={refreshState} pending={pending} onCreate={() => setCreating(true)} refresh={revalidate} active={panelActive && workspace.panel === 'sessions'} selectedTerminalId={activeTab} onSelectTerminal={selectTerminal} homeDirectory={homeDirectory} managedSessions={managedSessions} sessions={sessions} providers={providers} selectedSession={selectedSession?.providerSessionId ? { provider: selectedSession.provider, id: selectedSession.providerSessionId } : undefined} openingSession={openingSession} openError={openError} onOpen={(session) => { void openSession(session); }} />
        </div>
        <Suspense fallback={<p role="status" className="p-3">Loading panel…</p>}>
          {['skills', 'agents', 'mcps'].includes(workspace.panel) && !libraries[workspace.panel as LibraryKind] && !libraryError && <p role="status" className="p-3 text-sm">Loading library…</p>}
          {libraryError?.kind === workspace.panel && <p role="alert" className="p-3">{libraryError.message}<Button onClick={() => { const kind = libraryError.kind; setLibraryError(null); void refreshLibrary(kind).catch(error => setLibraryError({ kind, message: String(error) })); }}>Retry</Button></p>}
          {(['skills', 'agents', 'mcps'] as const).filter(kind => libraries[kind]).map(kind => { const Panel = libraryPanels[kind]; return <div key={kind} hidden={workspace.panel !== kind} className="h-full"><Panel items={libraries[kind]!} refresh={() => refreshLibrary(kind)} onOpen={item => openEditor(kind, item)} /></div>; })}
          {visited.includes('settings') && <div hidden={workspace.panel !== 'settings'} className="h-full"><SettingsPanel active={panelActive && workspace.panel === 'settings'} /></div>}
        </Suspense>
      </SessionExplorer>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {stopError && <p role="alert" className="p-3 text-sm text-destructive">{stopError}</p>}
        <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <WorkspaceTabBar actions={<>
            {selectedSession?.status === 'running' && <form className="shrink-0 border-l border-border" onSubmit={event => {
              event.preventDefault(); if (stopping) return; setStopping(true); setStopError('');
              void api(`/sessions/${encodeURIComponent(selectedSession.id)}`, { method: 'DELETE' }).then(revalidate).catch(error => setStopError(error instanceof Error ? error.message : 'Unable to stop session.')).finally(() => setStopping(false));
            }}>
              <input type="hidden" name="sessionId" value={selectedSession.id} />
              <Button type="submit" name="intent" value="stop" variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={pending} aria-label="Stop session" title="Stop session"><Square aria-hidden="true" /></Button>
            </form>}

          </>}>
            <Tabs.List aria-label="Session tabs" className="flex shrink-0 items-center">
              {visibleSessions.map((session) => {
                const name = providers.find((provider) => provider.id === session.provider)?.name ?? session.provider;
                const directory = session.workingDirectory.split('/').filter(Boolean).at(-1) ?? '/';
                const saved = sessions.find((entry) => entry.provider === session.provider && entry.id === session.providerSessionId);
                return <div key={session.id} className={`flex shrink-0 items-center border-r border-t-2 border-border ${activeTab === session.id ? 'border-t-blue-400 bg-background' : 'border-t-transparent hover:bg-accent'}`}>
                  <Tabs.Trigger value={session.id} title={`${name} · ${session.workingDirectory} · ${saved?.title ?? session.id}`} className="flex h-9.5 max-w-40 shrink-0 items-center gap-1.5 px-2 text-xs md:max-w-56 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:text-foreground">
                    <span aria-label={sessionActivity(session).label} className={`size-1.5 shrink-0 rounded-full ${sessionActivity(session).needsInput ? 'bg-amber-400' : sessionActivity(session).running ? 'bg-emerald-400' : session.status === 'running' && session.taskActivity === 'not-running' ? 'bg-blue-400' : 'bg-muted-foreground'}`} />
                    <span className="min-w-0 truncate text-left">{name} · {saved?.title ?? directory}</span>
                  </Tabs.Trigger>
                  <button type="button" aria-label={`Close ${name} · ${saved?.title ?? directory} tab`} title="Close tab" onClick={() => closeTab(session.id)} className="mr-1 rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </div>;
              })}
              {editors.map(tab => <div key={tab.key} className="flex shrink-0 items-center border-r border-border"><Tabs.Trigger value={tab.key} className="h-9.5 max-w-48 truncate px-3 text-xs data-[state=active]:text-blue-400">{tab.item === 'new' ? `New ${tab.kind}` : tab.item.name}{tab.dirty ? ' •' : ''}</Tabs.Trigger><button type="button" aria-label="Close editor" onClick={() => closeTab(tab.key)} className="p-2"><X className="size-3" /></button></div>)}
            </Tabs.List>
            <Button type="button" variant="ghost" size="icon" aria-label="New session" title="New session" onClick={() => setCreating(true)}><Plus aria-hidden="true" /></Button>
          </WorkspaceTabBar>
          {!selectedSession && !editors.some(tab => tab.key === activeTab) && <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <h2 className="text-lg font-medium">Your coding workspace</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Open a saved session from the explorer to continue, or start a new session.</p>
            <Button type="button" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New session</Button>
          </div>}
          {visibleSessions.map((session) => {
            const providerName = providers.find((provider) => provider.id === session.provider)?.name ?? session.provider;
            return (
              <Tabs.Content forceMount key={session.id} value={session.id} hidden={activeTab !== session.id} className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col">
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
          {editors.map(tab => <Tabs.Content forceMount key={tab.key} value={tab.key} hidden={activeTab !== tab.key} className="min-h-0 flex-1 flex-col data-[state=active]:flex data-[state=inactive]:hidden"><Suspense fallback={<p role="status">Loading editor…</p>}><LibraryEditor kind={tab.kind} editing={tab.item} refresh={() => refreshLibrary(tab.kind)} onClose={() => closeTab(tab.key)} onDirty={dirty => setEditors(previous => previous.map(entry => entry.key === tab.key ? { ...entry, dirty } : entry))} onSaved={item => { setEditors(previous => previous.map(entry => entry.key === tab.key ? { ...entry, item, dirty: false } : entry)); }} /></Suspense></Tabs.Content>)}
        </Tabs.Root>
      </div>
      {creating && <NewSessionDialog providers={providers} defaultProviderId={defaultProviderId} defaultWorkingDirectory={defaultWorkingDirectory} directories={directories} onClose={() => setCreating(false)} onCreated={onCreated} />}
    </div>
    </AppLayout>
  );
}
