import type { Dispatch, SetStateAction } from 'react';
import type { AgentDefinition } from '@agentdex/shared';
import { Button } from '@/components/ui/shadcn/button';
import { agentMarkdown, parseAgentMarkdown } from '@/lib/agentMarkdown';

interface Props { markdownMode: boolean; setMarkdownMode: Dispatch<SetStateAction<boolean>>; agent: AgentDefinition; setAgent: Dispatch<SetStateAction<AgentDefinition>>; content: string; setContent: Dispatch<SetStateAction<string>>; setMessage: Dispatch<SetStateAction<string>>; isNew: boolean; fieldClass: string }
export default function AgentEditor({ markdownMode, setMarkdownMode, agent, setAgent, content, setContent, setMessage, isNew, fieldClass }: Props) { return <div className="space-y-4">
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { try { if (markdownMode) setAgent(parseAgentMarkdown(content)); else setContent(agentMarkdown(agent)); setMarkdownMode(!markdownMode); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid Markdown.'); } }}>{markdownMode ? 'Switch to form' : 'Import / edit Markdown'}</Button></div>
          {markdownMode ? <label className="block space-y-1"><span>agent.md</span><textarea required rows={14} value={content} onChange={e => setContent(e.target.value)} className={`${fieldClass} font-mono`} /></label> : <>
            <label className="block space-y-1"><span>Original name (immutable)</span><input required readOnly={!isNew} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} value={agent.name} onChange={e => setAgent({ ...agent, name: e.target.value })} className={fieldClass} /></label>
            <label className="block space-y-1"><span>Description</span><textarea required value={agent.description} onChange={e => setAgent({ ...agent, description: e.target.value })} className={fieldClass} /></label>
            <label className="block space-y-1"><span>Instructions</span><textarea required rows={12} value={agent.instructions} onChange={e => setAgent({ ...agent, instructions: e.target.value })} className={fieldClass} /></label>
          </>}
          <p className="text-xs text-muted-foreground">Saving does not update providers. Sync to publish globally, then ask your provider to use the named subagent. Reload or restart the provider if needed.</p>
        </div>; }
