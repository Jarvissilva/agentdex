import { useState } from 'react';
import type { Destination, LibraryItem, LibraryKind, SyncResponse } from '@agentdex/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/shadcn/button';

const labels: Record<Destination, string> = { agents: 'Codex / OpenCode', antigravity: 'Antigravity', codex: 'Codex', opencode: 'OpenCode' };

export interface LibraryPanelProps { kind: LibraryKind; items: LibraryItem[]; refresh: () => Promise<void>; onOpen: (item: LibraryItem | 'new') => void }
export default function LibraryPanel({ kind, items, refresh, onOpen }: LibraryPanelProps) {
 const [selectedId, setSelectedId] = useState('');
 const [selected, setSelected] = useState<Record<string, Destination[]>>({});
 const [credentialSources, setCredentialSources] = useState<Record<string, Destination | ''>>({});
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const skills = kind === 'skills', agents = kind === 'agents';
 const title = skills ? 'Skills' : agents ? 'Agents' : 'MCP servers';
 async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); } finally { setBusy(false); } }
 return <section className="flex h-full min-h-0 flex-col"><header className="flex h-14 shrink-0 items-center justify-between px-3"><h1 className="text-xs font-medium uppercase tracking-wider">{title}</h1><Button variant="ghost" size="icon-sm" aria-label={`Create ${kind}`} onClick={() => onOpen('new')}>+</Button></header>{message && <p role="status" className="p-3 text-xs whitespace-pre-wrap">{message}</p>}
      <div className="min-h-0 flex-1 overflow-auto">{!items.length && <p className="mx-3 rounded border border-dashed border-border p-3 text-sm text-muted-foreground">No {agents ? 'agents' : skills ? 'skills' : 'MCP servers'} yet. Create one to get started.</p>}
      {items.map(item => <button type="button" key={item.id} onClick={() => { setSelectedId(item.id); onOpen(item); }} className="w-full truncate border-b border-border px-3 py-2 text-left text-sm hover:bg-accent">{item.name}</button>)}
      {items.filter(item => item.id === selectedId).map(item => <article key={item.id} className="space-y-4 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{item.name}</h2><p className="mt-1 text-xs text-muted-foreground">{item.nativeName}</p>{item.definition && <p className="mt-2 text-sm">{item.definition.transport} · {item.definition.enabled ? 'Enabled' : 'Disabled'}</p>}</div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => onOpen(item)}>Edit</Button></div></div>
        {item.credentialMigrationRequired && <p className="text-sm text-muted-foreground">This MCP has older credential copies in Agentdex storage. Sync each installed destination to move credentials into provider configuration and remove those copies.</p>}
        <div className="flex flex-wrap gap-5">{item.installations.map(installation => <label key={installation.destination} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(selected[item.id] ?? []).includes(installation.destination)} onChange={e => setSelected(previous => ({ ...previous, [item.id]: e.target.checked ? [...previous[item.id] ?? [], installation.destination] : (previous[item.id] ?? []).filter(d => d !== installation.destination) }))} />{labels[installation.destination]}<span className="text-muted-foreground">{installation.status}</span></label>)}</div>
        {kind === 'mcps' && <label className="flex flex-wrap items-center gap-2 text-sm">Credential source<select aria-label={`Credential source for ${item.name}`} className="w-full min-w-0 max-w-full rounded border border-border bg-background p-2" value={credentialSources[item.id] ?? ''} onChange={e => setCredentialSources(previous => ({ ...previous, [item.id]: e.target.value as Destination | '' }))}><option value="">Automatic (matching credentials)</option>{item.installations.filter(installation => installation.status === 'installed' || installation.status === 'outdated').map(installation => <option key={installation.destination} value={installation.destination}>{labels[installation.destination]}</option>)}</select></label>}

      </article>)}
</div>{items.filter(item => item.id === selectedId).map(item => <div key={item.id}>        <div className="shrink-0 border-t border-border px-3 flex flex-wrap gap-2 bg-sidebar py-3">{(['sync', 'uninstall'] as const).map(action => <Button key={action} variant={action === 'sync' ? 'default' : 'outline'} disabled={busy || !selected[item.id]?.length} onClick={() => void run(async () => { const result = await api<SyncResponse>(`/${kind}/${item.id}/${action}`, { method: 'POST', body: JSON.stringify({ destinations: selected[item.id], ...(action === 'sync' && credentialSources[item.id] ? { credentialSource: credentialSources[item.id] } : {}) }) }); setMessage(result.results.map(r => `${labels[r.destination]}: ${r.status}${r.message ? ` — ${r.message}` : ''}`).join('\n')); })}>{action === 'sync' ? 'Sync' : 'Uninstall'}</Button>)}<Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Delete ${item.name} and uninstall its owned publications?`)) void run(async () => { await api(`/${kind}/${item.id}`, { method: 'DELETE' }); setMessage('Deleted.'); }); }}>Delete</Button></div></div>)}
</section>;
}

type PanelProps = Omit<LibraryPanelProps, 'kind'>;
export function SkillsPanel(props: PanelProps) { return <LibraryPanel {...props} kind="skills" />; }
export function AgentsPanel(props: PanelProps) { return <LibraryPanel {...props} kind="agents" />; }
export function McpsPanel(props: PanelProps) { return <LibraryPanel {...props} kind="mcps" />; }
