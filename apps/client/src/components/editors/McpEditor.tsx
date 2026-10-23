import type { Dispatch, SetStateAction } from 'react';
import type { McpDefinition } from '@agentdex/shared';
import { Button } from '@/components/ui/shadcn/button';

interface Props { jsonMode: boolean; toggleJson: () => void; mcpJson: string; setMcpJson: Dispatch<SetStateAction<string>>; definition: McpDefinition; setDefinition: Dispatch<SetStateAction<McpDefinition>>; args: string; setArgs: Dispatch<SetStateAction<string>>; env: string; setEnv: Dispatch<SetStateAction<string>>; headers: string; setHeaders: Dispatch<SetStateAction<string>>; fieldClass: string }
export default function McpEditor({ jsonMode, toggleJson, mcpJson, setMcpJson, definition, setDefinition, args, setArgs, env, setEnv, headers, setHeaders, fieldClass }: Props) { return <div className="space-y-4">
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
          <p className="text-xs text-muted-foreground">Keep •••••• values to reuse credentials from your providers. New values are held in memory until Sync; they are lost if the server restarts. Saving does not sync providers.</p>
        </div>; }
