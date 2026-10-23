import { useState } from 'react';
import type { Provider, ProviderSession } from '@agentdex/shared';

interface Props {
  sessions: ProviderSession[];
  providers: Provider[];
}

export default function SessionList({ sessions, providers }: Props) {
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const query = search.trim().toLowerCase();
  const visible = sessions.filter((session) => (!provider || session.provider === provider)
    && `${session.title} ${session.workingDirectory} ${session.id}`.toLowerCase().includes(query));
  const names = new Map(providers.map((entry) => [entry.id, entry.name]));

  return (
    <section aria-labelledby="session-history-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="session-history-title" className="text-sm font-medium">All sessions <span className="ml-1 text-muted-foreground">{sessions.length}</span></h2>
          <p className="mt-1 text-xs text-muted-foreground">Includes sessions started outside Agentdex and archived sessions.</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <input aria-label="Search sessions" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, directory, or ID…" className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <select aria-label="Filter sessions by provider" value={provider} onChange={(event) => setProvider(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All providers</option>
            {providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>
      </div>
      {visible.length ? (
        <div className="max-h-96 overflow-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm" aria-label="All provider sessions">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr><th scope="col" className="px-4 py-3 font-medium">Session</th><th scope="col" className="px-4 py-3 font-medium">Provider</th><th scope="col" className="px-4 py-3 font-medium">Working directory</th><th scope="col" className="px-4 py-3 font-medium">Updated</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((session) => (
                <tr key={`${session.provider}:${session.id}`} className="align-top hover:bg-accent/30">
                  <td className="min-w-48 max-w-sm px-4 py-3">
                    <p className="line-clamp-2 break-words" title={session.title}>{session.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{session.archived ? 'Archived' : 'Saved'} · <span className="font-mono" title={session.id}>{session.id.slice(0, 8)}</span></p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{names.get(session.provider) ?? session.provider}</td>
                  <td className="min-w-48 max-w-xs break-all px-4 py-3 font-mono text-xs text-muted-foreground">{session.workingDirectory || '—'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-muted-foreground"><time dateTime={session.updatedAt} title={new Date(session.updatedAt).toLocaleString()}>{new Date(session.updatedAt).toLocaleDateString()}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{sessions.length ? 'No sessions match your filters.' : 'No saved sessions found.'}</p>}
      <p className="text-xs text-muted-foreground">Saved history does not confirm live status. Only the terminal launched in Agentdex can be controlled here.</p>
    </section>
  );
}
