import EditorFrame from '@/components/workspace/EditorFrame';
import { useState } from 'react';
import type { AgentDefinition, LibraryInput, LibraryItem, LibraryKind, McpDefinition } from '@agentdex/shared';
import AgentEditor from './AgentEditor';
import SkillEditor from './SkillEditor';
import McpEditor from './McpEditor';
import { api } from '@/lib/api';
import { parseMcpJson } from '@/lib/mcpJson';
import { Button } from '@/components/ui/shadcn/button';

const initialSkill = '---\nname: my-skill\ndescription: Describe when to use this skill.\n---\n\n# Instructions\n';
const initialMcp: McpDefinition = { transport: 'stdio', enabled: true, command: '', args: [], env: {} };
export interface EditorProps { kind: LibraryKind; editing: LibraryItem | 'new'; refresh: () => Promise<void>; onSaved: (item: LibraryItem) => void; onClose: () => void; onDirty: (dirty: boolean) => void }
export default function LibraryEditor({ kind, editing, refresh, onSaved, onClose, onDirty }: EditorProps) {
  const [name, setName] = useState(editing === 'new' ? '' : editing.name);
  const [importedName, setImportedName] = useState<string>();
  const [content, setContent] = useState(editing === 'new' ? initialSkill : editing.content ?? '');
  const [definition, setDefinition] = useState<McpDefinition>(editing === 'new' ? initialMcp : editing.definition ?? initialMcp);
  const [jsonMode, setJsonMode] = useState(false);
  const [mcpJson, setMcpJson] = useState('');
  const [args, setArgs] = useState(JSON.stringify(definition.args ?? [], null, 2));
  const [env, setEnv] = useState(JSON.stringify(definition.env ?? {}, null, 2));
  const [headers, setHeaders] = useState(JSON.stringify(definition.headers ?? {}, null, 2));
  const [importPath, setImportPath] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const skills = kind === 'skills';
  const agents = kind === 'agents';
  const singular = skills ? 'skill' : agents ? 'agent' : 'MCP';
  const [agent, setAgent] = useState<AgentDefinition>(editing === 'new' ? { name: '', description: '', instructions: '' } : editing.agent ?? { name: '', description: '', instructions: '' });
  const [markdownMode, setMarkdownMode] = useState(false);
  const fieldClass = 'w-full rounded border border-border bg-background p-2 text-sm';
  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  function toggleJson() {
    try {
      if (jsonMode) {
        const parsed = parseMcpJson(mcpJson);
        setImportedName(parsed.name ?? importedName);
        setDefinition(parsed.definition); setArgs(JSON.stringify(parsed.definition.args ?? [], null, 2)); setEnv(JSON.stringify(parsed.definition.env ?? {}, null, 2)); setHeaders(JSON.stringify(parsed.definition.headers ?? {}, null, 2));
        if (!name.trim() && parsed.name) setName(parsed.name);
      } else setMcpJson(JSON.stringify({ ...definition, args: JSON.parse(args) as string[], env: JSON.parse(env) as Record<string, string>, headers: JSON.parse(headers) as Record<string, string> }, null, 2));
      setJsonMode(!jsonMode); setMessage('');
    } catch { setMessage(jsonMode ? 'Check the MCP JSON before switching to the form.' : 'Check the JSON in the form fields before switching.'); }
  }
  return <div className="flex min-h-0 flex-1 flex-col">{message && <p role="status" className="p-3 text-sm">{message}</p>}
      {editing && <form inert={busy} className="flex min-h-0 flex-1 flex-col" onChange={() => onDirty(true)} onSubmit={event => {
        event.preventDefault(); void run(async () => {
          const parsed = kind === 'mcps' && jsonMode ? parseMcpJson(mcpJson) : undefined;
          const input: LibraryInput = { nativeName: parsed?.name ?? importedName, name: name.trim() || parsed?.name || '', ...(agents ? markdownMode ? { content } : { agent } : skills ? { content } : { definition: parsed?.definition ?? { ...definition, args: JSON.parse(args) as string[], env: JSON.parse(env) as Record<string, string>, headers: JSON.parse(headers) as Record<string, string> } }) };
          const saved = await api<{ item: LibraryItem }>(`/${kind}${editing === 'new' ? '' : `/${editing.id}`}`, { method: editing === 'new' ? 'POST' : 'PUT', body: JSON.stringify(input) }); onSaved(saved.item); setMessage(skills || agents ? 'Saved. Select destinations to sync.' : 'Saved. Sync now to send credentials to your providers. New credential values are held in memory only.');
        });
      }}>
        <EditorFrame footer={<><Button disabled={busy} type="submit">Save</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></>}><h2 className="font-medium">{editing === 'new' ? 'Create' : 'Edit'} {singular}</h2>
        <label className="block space-y-1"><span>Display name</span><input required={!jsonMode} value={name} onChange={e => setName(e.target.value)} className={fieldClass} /></label>
        {agents ? <AgentEditor markdownMode={markdownMode} setMarkdownMode={setMarkdownMode} agent={agent} setAgent={setAgent} content={content} setContent={setContent} setMessage={setMessage} isNew={editing === 'new'} fieldClass={fieldClass} /> : skills ? <SkillEditor content={content} setContent={setContent} fieldClass={fieldClass} /> : <McpEditor jsonMode={jsonMode} toggleJson={toggleJson} mcpJson={mcpJson} setMcpJson={setMcpJson} definition={definition} setDefinition={setDefinition} args={args} setArgs={setArgs} env={env} setEnv={setEnv} headers={headers} setHeaders={setHeaders} fieldClass={fieldClass} />}
        {skills && editing === 'new' && <div className="space-y-2 border-t border-border pt-4"><label className="block space-y-1"><span>Or import a complete local folder</span><input placeholder="Absolute folder path" value={importPath} onChange={e => setImportPath(e.target.value)} className={fieldClass} /></label><Button type="button" variant="outline" disabled={busy || !importPath || !name} onClick={() => void run(async () => { const saved = await api<{ item: LibraryItem }>('/skills/import', { method: 'POST', body: JSON.stringify({ name, path: importPath }) }); onSaved(saved.item); setMessage('Imported. Select destinations to sync.'); })}>Import folder</Button></div>}
</EditorFrame>
      </form>}
 </div>;
}
