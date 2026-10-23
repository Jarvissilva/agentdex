import { useState } from 'react';
import type { Provider, ProviderSession } from '@agentdex/shared';
import { Button } from '@/components/ui/shadcn/button';

interface Props {
  sessions: ProviderSession[];
  providers: Provider[];
}

export default function SessionList({ sessions, providers }: Props) {
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [visibleCounts, setVisibleCounts] = useState<Map<string, number>>(() => new Map());
  const query = search.trim().toLowerCase();
  const visible = sessions.filter((session) => (!provider || session.provider === provider)
    && `${session.title} ${session.workingDirectory} ${session.id}`.toLowerCase().includes(query));
  const grouped = new Map<string, [ProviderSession, ...ProviderSession[]]>();
  for (const session of visible) {
    const directory = session.workingDirectory || '';
    const group = grouped.get(directory);
    if (group) group.push(session);
    else grouped.set(directory, [session]);
  }
  for (const group of grouped.values()) {
    group.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  const groups = [...grouped].sort((a, b) => Date.parse(b[1][0].updatedAt) - Date.parse(a[1][0].updatedAt));
  const names = new Map(providers.map((entry) => [entry.id, entry.name]));

  return (
    <section aria-labelledby="session-history-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="session-history-title" className="text-sm font-medium">All sessions <span className="ml-1 text-muted-foreground">{sessions.length}</span></h2>
          <p className="mt-1 text-xs text-muted-foreground">Includes sessions started outside Agentdex and archived sessions.</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <input aria-label="Search sessions" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCounts(new Map()); }} placeholder="Search title, directory, or ID…" className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <select aria-label="Filter sessions by provider" value={provider} onChange={(event) => { setProvider(event.target.value); setVisibleCounts(new Map()); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All providers</option>
            {providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>
      </div>
      {visible.length ? (
        <div className="space-y-4">
          {groups.map(([directory, group]) => {
            const count = visibleCounts.get(directory) ?? 5;
            return (
              <section key={directory} aria-label={directory || 'Unknown working directory'} className="min-w-0 rounded-xl border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <h3 className="min-w-0 break-all font-mono text-sm font-medium">{directory || 'Unknown working directory'}</h3>
                  <span className="shrink-0 text-xs text-muted-foreground">{group.length} {group.length === 1 ? 'session' : 'sessions'}</span>
                </div>
                <ul className="divide-y divide-border">
                  {group.slice(0, count).map((session) => (
                    <li key={`${session.provider}:${session.id}`} className="grid min-w-0 gap-2 px-4 py-3 text-sm hover:bg-accent/30 sm:grid-cols-[minmax(0,1fr)_8rem_6rem] sm:gap-4">
                      <div className="min-w-0">
                        <p className="line-clamp-2 break-words" title={session.title}>{session.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{session.archived ? 'Archived' : 'Saved'} · <span className="font-mono" title={session.id}>{session.id.slice(0, 8)}</span></p>
                      </div>
                      <p className="break-words text-muted-foreground">{names.get(session.provider) ?? session.provider}</p>
                      <p className="text-xs text-muted-foreground"><span className="sm:sr-only">Updated </span><time dateTime={session.updatedAt} title={new Date(session.updatedAt).toLocaleString()}>{new Date(session.updatedAt).toLocaleDateString()}</time></p>
                    </li>
                  ))}
                </ul>
                {count < group.length && (
                  <div className="border-t border-border px-4 py-3">
                    <Button type="button" variant="outline" size="sm" aria-label={`View more sessions in ${directory || 'Unknown working directory'}`} onClick={() => setVisibleCounts((counts) => {
                      const next = new Map(counts);
                      next.set(directory, (counts.get(directory) ?? 5) + 5);
                      return next;
                    })}>View more</Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{sessions.length ? 'No sessions match your filters.' : 'No saved sessions found.'}</p>}
      <p className="text-xs text-muted-foreground">Saved history does not confirm live status. Only the terminal launched in Agentdex can be controlled here.</p>
    </section>
  );
}
