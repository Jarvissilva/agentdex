import { useState } from 'react';
import { useLoaderData, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import type { Destination, LibraryInput, LibraryItem, LibraryKind, LibraryResponse, McpDefinition, SyncResponse } from '@agentdex/shared';
import { api } from '@/lib/api';
import { parseMcpJson } from '@/lib/mcpJson';
import { Button } from '@/components/ui/shadcn/button';

export async function libraryLoader({ request }: LoaderFunctionArgs) {
  const kind: LibraryKind = new URL(request.url).pathname === '/skills' ? 'skills' : 'mcps';
  return { kind, ...await api<LibraryResponse>(`/${kind}`) };
}
const initialSkill = '---\nname: my-skill\ndescription: Describe when to use this skill.\n---\n\n# Instructions\n';
const initialMcp: McpDefinition = { transport: 'stdio', enabled: true, command: '', args: [], env: {} };
const labels: Record<Destination, string> = { agents: 'Codex / OpenCode', antigravity: 'Antigravity', codex: 'Codex', opencode: 'OpenCode' };

export default function Library() {
  const data = useLoaderData<typeof libraryLoader>();
  return <LibraryPage key={data.kind} {...data} />;
}

function LibraryPage({ kind, items }: Awaited<ReturnType<typeof libraryLoader>>) {
  const revalidator = useRevalidator();
  const [editing, setEditing] = useState<LibraryItem | 'new' | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState(initialSkill);
  const [definition, setDefinition] = useState<McpDefinition>(initialMcp);
  const [jsonMode, setJsonMode] = useState(false);
  const [mcpJson, setMcpJson] = useState('');
  const [args, setArgs] = useState('[]');
  const [env, setEnv] = useState('{}');
  const [headers, setHeaders] = useState('{}');
  const [importPath, setImportPath] = useState('');
  const [selected, setSelected] = useState<Record<string, Destination[]>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const skills = kind === 'skills';
  const fieldClass = 'w-full rounded border border-border bg-background p-2 text-sm';
  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); await revalidator.revalidate(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  function edit(item: LibraryItem | 'new') {
    setJsonMode(false); setMcpJson('');
    setEditing(item); setName(item === 'new' ? '' : item.name); setContent(item === 'new' ? initialSkill : item.content ?? '');
    const d = item === 'new' ? initialMcp : item.definition ?? initialMcp;
    setDefinition(d); setArgs(JSON.stringify(d.args ?? [], null, 2)); setEnv(JSON.stringify(d.env ?? {}, null, 2)); setHeaders(JSON.stringify(d.headers ?? {}, null, 2)); setImportPath('');
  }
  function toggleJson() {
    try {
      if (jsonMode) {
        const parsed = parseMcpJson(mcpJson);
        setDefinition(parsed.definition); setArgs(JSON.stringify(parsed.definition.args ?? [], null, 2)); setEnv(JSON.stringify(parsed.definition.env ?? {}, null, 2)); setHeaders(JSON.stringify(parsed.definition.headers ?? {}, null, 2));
        if (!name.trim() && parsed.name) setName(parsed.name);
      } else setMcpJson(JSON.stringify({ ...definition, args: JSON.parse(args) as string[], env: JSON.parse(env) as Record<string, string>, headers: JSON.parse(headers) as Record<string, string> }, null, 2));
      setJsonMode(!jsonMode); setMessage('');
    } catch { setMessage(jsonMode ? 'Check the MCP JSON before switching to the form.' : 'Check the JSON in the form fields before switching.'); }
  }
  return <section aria-label={skills ? 'Skills library' : 'MCP library'} className="flex-1 overflow-auto p-6 md:p-10">
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">{skills ? 'Skills' : 'MCP servers'}</h1><p className="mt-2 text-sm text-muted-foreground">Your central library. Select destinations and sync manually after saving changes.</p></div><Button onClick={() => edit('new')} disabled={busy}>Create {skills ? 'skill' : 'MCP'}</Button></div>
      {message && <p role="status" className="whitespace-pre-wrap rounded border border-border p-3 text-sm">{message}</p>}
      {editing && <form className="space-y-4 rounded border border-border p-5" onSubmit={event => {
        event.preventDefault(); void run(async () => {
          const parsed = !skills && jsonMode ? parseMcpJson(mcpJson) : undefined;
          const input: LibraryInput = { name: name.trim() || parsed?.name || '', ...(skills ? { content } : { definition: parsed?.definition ?? { ...definition, args: JSON.parse(args) as string[], env: JSON.parse(env) as Record<string, string>, headers: JSON.parse(headers) as Record<string, string> } }) };
          await api(`/${kind}${editing === 'new' ? '' : `/${editing.id}`}`, { method: editing === 'new' ? 'POST' : 'PUT', body: JSON.stringify(input) }); setEditing(null); setMessage('Saved. Select destinations to sync.');
        });
      }}>
        <h2 className="font-medium">{editing === 'new' ? 'Create' : 'Edit'} {skills ? 'skill' : 'MCP server'}</h2>
        <label className="block space-y-1"><span>Display name</span><input required={!jsonMode} value={name} onChange={e => setName(e.target.value)} className={fieldClass} /></label>
        {skills ? <label className="block space-y-1"><span>SKILL.md</span><textarea rows={12} required value={content} onChange={e => setContent(e.target.value)} className={`${fieldClass} font-mono`} /></label> : <div className="space-y-4">
          <div className="flex gap-2" role="group" aria-label="MCP input mode"><Button type="button" variant={jsonMode ? 'outline' : 'default'} aria-pressed={!jsonMode} disabled={!jsonMode} onClick={toggleJson}>Form</Button><Button type="button" variant={jsonMode ? 'default' : 'outline'} aria-pressed={jsonMode} disabled={jsonMode} onClick={toggleJson}>JSON</Button></div>
          {jsonMode ? <label className="block space-y-1"><span>MCP JSON</span><textarea required rows={14} spellCheck={false} value={mcpJson} onChange={e => setMcpJson(e.target.value)} className={`${fieldClass} font-mono`} /><p className="text-xs text-muted-foreground">Paste a server definition with command or URL, or an mcpServers object containing one server. The server key can supply the display name.</p></label> : <>
          <div className="flex flex-wrap items-center gap-5"><label className="flex items-center gap-2">Transport<select className={fieldClass} value={definition.transport} onChange={e => setDefinition({ ...definition, transport: e.target.value as McpDefinition['transport'] })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label><label className="flex items-center gap-2"><input type="checkbox" checked={definition.enabled} onChange={e => setDefinition({ ...definition, enabled: e.target.checked })} />Enabled</label></div>
          {definition.transport === 'stdio' ? <>
            <label className="block space-y-1"><span>Command</span><input required className={fieldClass} value={definition.command ?? ''} onChange={e => setDefinition({ ...definition, command: e.target.value })} /></label>
            <label className="block space-y-1"><span>Arguments (JSON array)</span><textarea rows={3} className={`${fieldClass} font-mono`} value={args} onChange={e => setArgs(e.target.value)} /></label>
            <label className="block space-y-1"><span>Environment variables (JSON object)</span><textarea rows={4} spellCheck={false} className={`${fieldClass} font-mono`} value={env} onChange={e => setEnv(e.target.value)} /></label>
            <label className="block space-y-1"><span>Working directory (optional absolute path)</span><input className={fieldClass} value={definition.cwd ?? ''} onChange={e => setDefinition({ ...definition, cwd: e.target.value || undefined })} /></label>
          </> : <>
            <label className="block space-y-1"><span>HTTP URL</span><input type="url" required className={fieldClass} value={definition.url ?? ''} onChange={e => setDefinition({ ...definition, url: e.target.value })} /></label>
            <label className="block space-y-1"><span>Headers (JSON object)</span><textarea rows={4} spellCheck={false} className={`${fieldClass} font-mono`} value={headers} onChange={e => setHeaders(e.target.value)} /></label>
          </>}
          </>}
          <p className="text-xs text-muted-foreground">Keep •••••• values to preserve saved secrets. Saving does not sync providers.</p>
        </div>}

        <div className="flex gap-2"><Button disabled={busy} type="submit">Save</Button><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
        {skills && editing === 'new' && <div className="space-y-2 border-t border-border pt-4"><label className="block space-y-1"><span>Or import a complete local folder</span><input placeholder="Absolute folder path" value={importPath} onChange={e => setImportPath(e.target.value)} className={fieldClass} /></label><Button type="button" variant="outline" disabled={busy || !importPath || !name} onClick={() => void run(async () => { await api('/skills/import', { method: 'POST', body: JSON.stringify({ name, path: importPath }) }); setEditing(null); setMessage('Imported. Select destinations to sync.'); })}>Import folder</Button></div>}
      </form>}
      {!items.length && <p className="rounded border border-dashed border-border p-8 text-muted-foreground">No {skills ? 'skills' : 'MCP servers'} yet. Create one to get started.</p>}
      {items.map(item => <article key={item.id} className="space-y-4 rounded border border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{item.name}</h2><p className="mt-1 text-xs text-muted-foreground">{item.nativeName}</p>{item.definition && <p className="mt-2 text-sm">{item.definition.transport} · {item.definition.enabled ? 'Enabled' : 'Disabled'}</p>}</div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => edit(item)}>Edit</Button><Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Delete ${item.name} and uninstall its owned publications?`)) void run(async () => { await api(`/${kind}/${item.id}`, { method: 'DELETE' }); setMessage('Deleted.'); }); }}>Delete</Button></div></div>
        <div className="flex flex-wrap gap-5">{item.installations.map(installation => <label key={installation.destination} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(selected[item.id] ?? []).includes(installation.destination)} onChange={e => setSelected(previous => ({ ...previous, [item.id]: e.target.checked ? [...previous[item.id] ?? [], installation.destination] : (previous[item.id] ?? []).filter(d => d !== installation.destination) }))} />{labels[installation.destination]}<span className="text-muted-foreground">{installation.status}</span></label>)}</div>
        <div className="flex gap-2">{(['sync', 'uninstall'] as const).map(action => <Button key={action} variant={action === 'sync' ? 'default' : 'outline'} disabled={busy || !selected[item.id]?.length} onClick={() => void run(async () => { const result = await api<SyncResponse>(`/${kind}/${item.id}/${action}`, { method: 'POST', body: JSON.stringify({ destinations: selected[item.id] }) }); setMessage(result.results.map(r => `${labels[r.destination]}: ${r.status}${r.message ? ` — ${r.message}` : ''}`).join('\n')); })}>{action === 'sync' ? 'Sync' : 'Uninstall'}</Button>)}</div>
      </article>)}
    </div>
  </section>;
}
