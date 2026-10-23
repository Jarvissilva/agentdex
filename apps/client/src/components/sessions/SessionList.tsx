import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, LoaderCircle, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { Provider, ProviderSession, Session, SessionsResponse } from '@agentdex/shared';
import { buildSessionRows, sessionRowActivity, sessionRowKey, type SessionListRow, type SessionStatusFilter } from '@/lib/sessionActivity';
import { compareSessionRows, filterSessionRows, visibleSessionRows, parseSessionPins, reconcileSessionPins, sessionPinsStorageKey } from '@/lib/sessionPins';
import RenameSessionDialog from './RenameSessionDialog';
import { Button } from '@/components/ui/shadcn/button';

interface Props {
  refresh: () => Promise<void>;
  active: boolean;
  sessions: ProviderSession[];
  managedSessions: Session[];
  providers: Provider[];
  dateRange: string;
  search: string;
  provider: string;
  homeDirectory: string;
  groupByDirectory: boolean;
  activity: SessionStatusFilter;
  onActivityChange: (activity: SessionStatusFilter) => void;
  selectedSession?: { provider: string; id: string };
  openingSession: { provider: string; id: string } | null;
  openError: { provider: string; id: string; message: string } | null;
  selectedTerminalId?: string;
  onSelectTerminal: (id: string) => void;
  onOpen: (session: ProviderSession) => void;
}

function sessionKey(session: { provider: string; id: string }) {
  return JSON.stringify([session.provider, session.id]);
}

function relativeTime(value: string, now: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function SessionList({ sessions, managedSessions, providers, dateRange, search, provider, homeDirectory, groupByDirectory, activity, onActivityChange, selectedSession, openingSession, openError, onOpen, selectedTerminalId, onSelectTerminal, refresh: revalidate, active }: Props) {
  const [selected, setSelected] = useState<ProviderSession | null>(null);
  const [directoryToDelete, setDirectoryToDelete] = useState<string | null>(null);
  const [confirmationPath, setConfirmationPath] = useState('');
  const [renaming, setRenaming] = useState<ProviderSession | null>(null);
  const [stopped, setStopped] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try { return parseSessionPins(localStorage.getItem(sessionPinsStorageKey)); }
    catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(sessionPinsStorageKey, JSON.stringify([...pinned])); }
    catch { /* Pinning remains available when browser storage is disabled. */ }
  }, [pinned]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const [visibleCounts, setVisibleCounts] = useState<Map<string, number>>(() => new Map());
  const filterKey = JSON.stringify([dateRange, search, provider, activity, groupByDirectory]);
  const [previousFilters, setPreviousFilters] = useState(filterKey);
  if (previousFilters !== filterKey) {
    setPreviousFilters(filterKey);
    setVisibleCounts(new Map());
  }
  const selectedActive = selected && sessions.some((session) => session.provider === selected.provider && session.id === selected.id && session.activity === 'active');
  const directorySessions = directoryToDelete === null ? [] : sessions.filter((session) => session.workingDirectory === directoryToDelete);
  const directoryHasAntigravity = directorySessions.some((session) => session.provider === 'agy');
  const directoryBlocked = directorySessions.some((session) => session.activity === 'active' || managedSessions.some((terminal) => terminal.provider === session.provider && terminal.status === 'running'));
  const query = search.trim().toLowerCase();
  const dateStart = new Date(now);
  dateStart.setHours(0, 0, 0, 0);
  if (dateRange === 'yesterday') dateStart.setDate(dateStart.getDate() - 1);
  if (dateRange === '7days') dateStart.setDate(dateStart.getDate() - 6);
  if (dateRange === '30days') dateStart.setDate(dateStart.getDate() - 29);
  const dateEnd = new Date(now);
  dateEnd.setHours(0, 0, 0, 0);
  if (dateRange !== 'yesterday') dateEnd.setDate(dateEnd.getDate() + 1);
  const rows = buildSessionRows(sessions, managedSessions, providers);
  const reconciledPins = reconcileSessionPins(rows, pinned);
  if (reconciledPins !== pinned) setPinned(reconciledPins);
  const matching = filterSessionRows(rows, reconciledPins, (session) => (provider === 'all' || session.provider === provider)
    && (dateRange === 'all' || (Date.parse(session.updatedAt) >= dateStart.getTime() && Date.parse(session.updatedAt) < dateEnd.getTime()))
    && `${session.title} ${session.workingDirectory} ${session.id}`.toLowerCase().includes(query));
  const effectiveActivity = sessionRowActivity;
  const visible = matching.filter((session) => activity === 'all' || effectiveActivity(session) === activity);
  const grouped = new Map<string, [SessionListRow, ...SessionListRow[]]>();
  for (const session of visible) {
    const directory = groupByDirectory ? session.workingDirectory || '' : '';
    const group = grouped.get(directory);
    if (group) group.push(session);
    else grouped.set(directory, [session]);
  }
  const activePins = reconciledPins;
  for (const group of grouped.values()) {
    group.sort((a, b) => compareSessionRows(a, b, activePins));
  }
  const groups = [...grouped].sort((a, b) => compareSessionRows(a[1][0], b[1][0], activePins));
  const displayed = groups.flatMap(([directory, group]) => visibleSessionRows(group, activePins, visibleCounts.get(directory) ?? 5, groupByDirectory && collapsed.has(directory)));
  const selectedKey = selectedSession ? sessionKey(selectedSession) : null;
  const names = new Map(providers.map((entry) => [entry.id, entry.name]));

  async function remove() {
    if (!selected) return;
    setDeleting(true);
    setError('');
    try {
      await api(`/sessions/history/${encodeURIComponent(selected.provider)}/${encodeURIComponent(selected.id)}`, {
        method: 'DELETE', body: JSON.stringify({ externalSessionsStopped: stopped }),
      });
      setSelected(null);
      await revalidate();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Deletion failed. Retry.');
      if (issue instanceof ApiRequestError && issue.status === 409) await revalidate();
    }
    finally { setDeleting(false); }
  }

  async function removeDirectory() {
    if (!directoryToDelete || confirmationPath !== directoryToDelete || directoryBlocked || (directoryHasAntigravity && !stopped) || deleting) return;
    setDeleting(true);
    setError('');
    let deleted = 0;
    try {
      let latest = await api<SessionsResponse>('/sessions');
      if (latest.discoveryErrors.length) throw new Error('Unable to load all sessions. Resolve provider discovery errors and retry.');
      const targets = latest.sessions.filter((session) => session.workingDirectory === directoryToDelete);
      if (targets.some((session) => session.activity === 'active')) throw new Error('Close all sessions in this directory in their providers before deleting, then refresh.');
      if (targets.some((session) => session.provider === 'agy') && !stopped) throw new Error('Confirm that external Antigravity sessions are stopped.');
      for (const target of targets) {
        // Parent deletion can already have removed a later child session.
        if (!latest.sessions.some((session) => sessionKey(session) === sessionKey(target))) continue;
        await api(`/sessions/history/${encodeURIComponent(target.provider)}/${encodeURIComponent(target.id)}`, {
          method: 'DELETE', body: JSON.stringify({ externalSessionsStopped: stopped }),
        });
        deleted++;
        latest = await api<SessionsResponse>('/sessions');
        if (latest.discoveryErrors.length) throw new Error('Unable to verify remaining sessions. Resolve provider discovery errors and retry.');
      }
      setDirectoryToDelete(null);
    } catch (issue) {
      setError(`${deleted} deletion${deleted === 1 ? '' : 's'} completed. ${issue instanceof Error ? issue.message : 'Deletion failed. Retry.'}`);
    } finally {
      await revalidate();
      setDeleting(false);
    }
  }

  return (
    <section aria-label="Saved sessions" className="min-w-0 space-y-3">
      {renaming && <RenameSessionDialog refresh={revalidate} session={renaming} onClose={() => setRenaming(null)} />}
      {directoryToDelete !== null && (
        <dialog ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={(event) => { event.preventDefault(); if (!deleting) setDirectoryToDelete(null); }} aria-labelledby="delete-directory-title" className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg rounded-xl bg-background p-0 text-foreground backdrop:bg-black/60">
          <div className="space-y-4 rounded-xl border border-border p-6">
            <h3 id="delete-directory-title" className="font-semibold">Delete all sessions in this directory?</h3>
            <p className="break-all font-mono text-xs">{directoryToDelete}</p>
            <p className="text-sm">Permanently delete all {directorySessions.length} saved sessions for this exact directory across all providers, including sessions hidden by filters and child sessions. Project files stay in place.</p>
            <label className="block space-y-2 text-sm">
              <span>Enter the full directory path to confirm.</span>
              <input type="text" value={confirmationPath} onChange={(event) => setConfirmationPath(event.target.value)} disabled={deleting} autoComplete="off" spellCheck={false} className="h-9 w-full rounded border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            {directoryHasAntigravity && <>
              <p className="text-sm">Antigravity deletion is local only. Cloud copies and shared logs remain.</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={stopped} onChange={(event) => setStopped(event.target.checked)} disabled={deleting} />I confirm that all external Antigravity sessions are stopped.</label>
            </>}
            {directoryBlocked && <p className="text-sm">Close active sessions in their providers and stop managed terminals for these providers before deleting, then refresh.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={deleting} onClick={() => setDirectoryToDelete(null)}>Cancel</Button>
              <Button type="button" variant="destructive" disabled={deleting || directoryBlocked || confirmationPath !== directoryToDelete || (directoryHasAntigravity && !stopped)} onClick={() => { void removeDirectory(); }}>{deleting ? 'Deleting…' : 'Delete all sessions'}</Button>
            </div>
          </div>
        </dialog>
      )}
      {selected && (
        <dialog ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={(event) => { event.preventDefault(); if (!deleting) setSelected(null); }} aria-labelledby="delete-session-title" className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg rounded-xl bg-background p-0 text-foreground backdrop:bg-black/60">
          <div className="max-h-full w-full max-w-lg space-y-4 overflow-auto rounded-xl border border-border bg-background p-6">
            <h3 id="delete-session-title" className="font-semibold">Delete {names.get(selected.provider) ?? selected.provider} session?</h3>
            <p className="break-words text-sm">{selected.title}</p>
            <p className="break-all font-mono text-xs">{selected.id}</p>
            <p className="text-sm">Deletion is permanent and includes child sessions.</p>
            {selected.provider === 'agy' && <>
              <p className="text-sm">Local-only deletion. Cloud copies and shared logs and knowledge remain outside scope.</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={stopped} onChange={(event) => setStopped(event.target.checked)} disabled={deleting} />I confirm that all external Antigravity sessions are stopped.</label>
            </>}
            {selectedActive && <p className="text-sm">Close this session in its provider before deleting, then refresh.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={deleting} onClick={() => setSelected(null)}>Cancel</Button>
              <Button type="button" disabled={deleting || !!selectedActive || (selected.provider === 'agy' && !stopped)} onClick={() => { void remove(); }}>{deleting ? 'Deleting…' : 'Delete permanently'}</Button>
            </div>
          </div>
        </dialog>
      )}
      <div role="group" aria-label="Filter sessions by activity" className="flex flex-wrap gap-1 border-b border-border px-2 pb-2 font-mono text-[10px]">
        {(['all', 'active', 'needs-input', 'inactive'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={activity === value} onClick={() => { onActivityChange(value); }} className={`inline-flex items-center gap-1 rounded px-1.5 py-1 capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring ${activity === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}>
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${value === 'active' ? 'bg-emerald-400' : value === 'needs-input' ? 'bg-amber-400' : value === 'inactive' ? 'bg-blue-400' : 'bg-muted-foreground'}`} />
            {value === 'active' ? 'Running' : value === 'inactive' ? 'Ready' : value === 'needs-input' ? 'Needs input' : value} <span className="tabular-nums text-muted-foreground">{value === 'all' ? matching.length : matching.filter((session) => effectiveActivity(session) === value).length}</span>
          </button>
        ))}
      </div>
      {openError && !displayed.some((session) => session.kind === 'saved' && sessionKey(session) === sessionKey(openError)) && <p role="alert" className="px-3 text-xs text-destructive">{openError.message}</p>}
      {visible.length ? (
        <div className="min-w-0 px-2 font-mono text-xs">
          {groups.map(([directory, group]) => {
            const count = visibleCounts.get(directory) ?? 5;
            const isCollapsed = groupByDirectory && collapsed.has(directory);
            const groupRows = visibleSessionRows(group, activePins, count, isCollapsed);
            const remaining = group.length - groupRows.length;
            const displayDirectory = directory.split('/').filter(Boolean).slice(-2).join('/') || directory;
            return (
              <section key={directory} aria-label={groupByDirectory ? directory || 'Unknown working directory' : 'Sessions'} className="min-w-0 pb-2">
                {groupByDirectory && <div className="flex min-w-0 items-center">
                <h3 className="min-w-0 flex-1">
                  <button type="button" aria-expanded={!isCollapsed} title={directory || 'Unknown working directory'} onClick={() => setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(directory)) next.delete(directory); else next.add(directory);
                    return next;
                  })} className="flex w-full min-w-0 items-center gap-1.5 px-2 py-2 text-left font-medium outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <ChevronRight aria-hidden="true" className={`size-3 shrink-0 ${isCollapsed ? '' : 'rotate-90'}`} />
                    {isCollapsed ? <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 break-all">{displayDirectory || 'Unknown working directory'}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{group.length}</span>
                  </button>
                </h3>
                <button type="button" aria-label={`Delete all sessions in ${directory}`} title="Delete all sessions in directory" disabled={!directory || !sessions.some((session) => session.workingDirectory === directory) || deleting || !!openingSession} onClick={() => { setDirectoryToDelete(directory); setConfirmationPath(''); setStopped(false); setError(''); }} className="mr-2 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"><Trash2 className="size-3" aria-hidden="true" /></button>
                </div>}
                {groupRows.length > 0 && <>
                  <ul className="space-y-1.5">
                    {groupRows.map((session) => {
                      const status = effectiveActivity(session);
                      const statusLabel = status === 'active' ? 'Running' : status === 'needs-input' ? 'Needs input' : status === 'inactive' ? 'Ready' : 'Unknown';
                      const key = sessionRowKey(session);
                      const isPinned = activePins.has(key);
                      const isSelected = session.kind === 'managed' ? selectedTerminalId === session.terminal.id : selectedKey === sessionKey(session);
                      const isOpening = session.kind === 'saved' && !!openingSession && sessionKey(openingSession) === sessionKey(session);
                      const issue = session.kind === 'saved' && openError && sessionKey(openError) === sessionKey(session) ? openError.message : null;
                      return (
                        <li key={key} className={`relative overflow-hidden rounded-lg border ${isSelected ? 'border-blue-400/50 bg-blue-500/15 text-blue-100' : 'border-border bg-background/50 hover:bg-accent/40'}`}>
                          <div className="flex min-w-0 items-center">
                            <button
                              ref={(element) => { if (element) rowButtons.current.set(key, element); else rowButtons.current.delete(key); }}
                              type="button" aria-pressed={isSelected} aria-busy={isOpening} disabled={deleting}
                              onClick={() => { if (!openingSession) { if (session.kind === 'managed') onSelectTerminal(session.terminal.id); else onOpen(session); } }}
                              onKeyDown={(event) => {
                                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                                event.preventDefault();
                                const index = displayed.findIndex((entry) => sessionRowKey(entry) === key);
                                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? displayed.length - 1 : Math.max(0, Math.min(displayed.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
                                const next = displayed[nextIndex];
                                if (next) rowButtons.current.get(sessionRowKey(next))?.focus();
                              }}
                              className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate" title={session.title}>{session.title}</span>
                                <span className="mt-0.5 flex min-w-0 items-start gap-1 text-[9px] leading-snug text-muted-foreground" title={session.workingDirectory || 'Unknown working directory'}>
                                  <Folder className="mt-0.5 size-2.5 shrink-0" aria-hidden="true" />
                                  <span className="min-w-0 break-all whitespace-normal">{homeDirectory && (session.workingDirectory === homeDirectory || session.workingDirectory.startsWith(`${homeDirectory}/`)) ? `~${session.workingDirectory.slice(homeDirectory.length)}` : session.workingDirectory || 'Unknown working directory'}</span>
                                </span>
                                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span title={session.id} className="truncate">{names.get(session.provider) ?? session.provider}{session.archived ? ' · Archived' : ''}</span>
                                  <span title={statusLabel} aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${status === 'needs-input' ? 'bg-amber-400' : status === 'active' ? 'bg-emerald-400' : status === 'inactive' ? 'bg-blue-400' : 'border border-muted-foreground'}`} />
                                  <span className="sr-only">{statusLabel}</span>
                                  <time dateTime={session.updatedAt} title={new Date(session.updatedAt).toLocaleString()} className="ml-auto shrink-0 tabular-nums">{relativeTime(session.updatedAt, now)}</time>
                                </span>
                              </span>
                              {isOpening && <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin" />}
                            </button>
                            <button type="button" aria-pressed={isPinned} aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${names.get(session.provider) ?? session.provider} session ${session.title}`} title={isPinned ? 'Unpin session' : 'Pin session'} className={`flex size-7 shrink-0 items-center justify-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${isPinned ? 'text-blue-400' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setPinned((previous) => {
                              const next = new Set(previous);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              return next;
                            })}>
                              {isPinned ? <PinOff aria-hidden="true" className="size-3" /> : <Pin aria-hidden="true" className="size-3" />}
                            </button>
                            <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30" onClick={() => { if (session.kind === 'saved') setRenaming(session); }} disabled={session.kind === 'managed' || deleting || !!openingSession} title="Rename session" aria-label={`Rename ${names.get(session.provider) ?? session.provider} session ${session.title}`}>
                              <Pencil aria-hidden="true" className="size-3" />
                            </button>
                            <button type="button" className="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30" onClick={() => { if (session.kind === 'saved') setSelected(session); setStopped(false); setError(''); }} disabled={session.kind === 'managed' || deleting || !!openingSession || session.activity === 'active'} title={session.kind === 'saved' && session.activity === 'active' ? 'Close this session in its provider before deleting, then refresh.' : 'Delete session'} aria-label={`Delete ${names.get(session.provider) ?? session.provider} session ${session.title}`}>
                              <Trash2 aria-hidden="true" className="size-3" />
                            </button>
                          </div>
                          {issue && <p role="alert" className="px-2 pb-2 text-[10px] text-destructive">{issue}</p>}
                        </li>
                      );
                    })}
                  </ul>
                  {!isCollapsed && remaining > 0 && <button type="button" className="mt-1 rounded px-1 py-1.5 text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={groupByDirectory ? `Show more sessions in ${directory || 'Unknown working directory'}` : 'Show more sessions'} onClick={() => setVisibleCounts((counts) => {
                    const next = new Map(counts);
                    next.set(directory, (counts.get(directory) ?? 5) + 5);
                    return next;
                  })}>Show more · {remaining} remaining</button>}
                </>}
              </section>
            );
          })}
        </div>
      ) : <p className="px-3 py-8 text-center text-xs text-muted-foreground">{rows.length ? 'No sessions match your filters.' : 'No saved sessions found.'}</p>}
    </section>
  );
}
