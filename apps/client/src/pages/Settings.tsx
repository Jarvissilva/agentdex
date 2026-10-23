import { useEffect, useState } from 'react';
import type { Settings as Preferences, ModelsResponse, ProvidersResponse, ManagedSessionsResponse, ClearMemoryResponse } from '@agentdex/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/shadcn/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';

const inputClass = 'h-9 w-full min-w-0 max-w-full rounded border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
function ProviderSettings({ id, name, directory, value, onChange }: { id: string; name: string; directory: string; value: Preferences['providers'][string]; onChange: (value: Preferences['providers'][string]) => void }) {
  const [catalog, setCatalog] = useState<ModelsResponse>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => { void api<ModelsResponse>(`/providers/${id}/models?${new URLSearchParams({ workingDirectory: directory, refresh: String(refresh > 0) })}`, { signal: controller.signal }).then(setCatalog).catch((error: unknown) => {
      if (!controller.signal.aborted) setCatalog({ models: [], status: 'unavailable', error: error instanceof Error ? error.message : 'Model discovery failed. Enter a custom ID.' });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, directory, refresh]);
  const options = catalog?.models.find(m => m.id === value.model)?.reasoning ?? [];
  const changeModel = (model: string) => onChange({ model, reasoning: '' });
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-3">
    <legend className="px-1 font-medium">{name}</legend><div className="flex justify-end"><Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => { setLoading(true); setRefresh(n => n + 1); }}>{loading ? 'Discovering…' : 'Refresh models'}</Button></div>
    {catalog?.error && <p role="status" className="text-xs text-muted-foreground">{catalog.error}</p>}
    <label className="block space-y-1 text-sm"><span>Model</span><Select value={value.model || '__default'} onValueChange={v => changeModel(v === '__default' ? '' : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__default">Use provider default</SelectItem>{value.model && !catalog?.models.some(m => m.id === value.model) && <SelectItem value={value.model}>{value.model} (custom)</SelectItem>}{catalog?.models.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent></Select></label>
    <label className="block space-y-1 text-sm"><span>Custom model ID</span><input className={inputClass} value={value.model} placeholder={id === 'opencode' ? 'provider/model' : 'Use provider default'} onChange={e => changeModel(e.target.value)} /></label>
    <label className="block space-y-1 text-sm"><span>{id === 'opencode' ? 'Reasoning / variant' : 'Reasoning'}</span><Select disabled={id === 'opencode' && !value.model} value={value.reasoning || '__default'} onValueChange={v => onChange({ ...value, reasoning: v === '__default' ? '' : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__default">Use provider default</SelectItem>{value.reasoning && !options.includes(value.reasoning) && <SelectItem value={value.reasoning}>{value.reasoning} (saved)</SelectItem>}{options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></label>
    {!options.length && <label className="block space-y-1 text-sm"><span>Custom {id === 'opencode' ? 'variant' : 'reasoning'}</span><input disabled={id === 'opencode' && !value.model} className={inputClass} value={value.reasoning} onChange={e => onChange({ ...value, reasoning: e.target.value })} /></label>}
    <p className="text-xs text-muted-foreground">Custom IDs are validated by the provider when launching.</p>
  </fieldset>;
}
export default function Settings({ active = true }: { active?: boolean }) {
  const [settings, setSettings] = useState<Preferences>();
  const [savedSettings, setSavedSettings] = useState<Preferences>();
  const [providers, setProviders] = useState<ProvidersResponse['providers']>([]);
  const [counts, setCounts] = useState({ running: 0, ended: 0 });
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<Preferences>('/settings', { signal: controller.signal }).then(value => { setSettings(value); setSavedSettings(value); }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load settings.'); });
    void api<ProvidersResponse>('/providers', { signal: controller.signal }).then(r => setProviders(r.providers)).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!active) return () => controller.abort();
    const update = () => { if (document.visibilityState !== 'visible') return; void api<ManagedSessionsResponse>('/sessions/managed', { signal: controller.signal }).then(r => setCounts({ running: r.managedSessions.filter(s => s.status === 'running').length, ended: r.managedSessions.filter(s => s.status === 'exited').length })).catch(() => {}); };
    update(); const timer = setInterval(update, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [retry, active]);
  useEffect(() => {
    if (JSON.stringify(settings) === JSON.stringify(savedSettings)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [settings, savedSettings]);
  async function save() {
    setBusy(true); setError(''); setFeedback('');
    try { const saved = await api<Preferences>('/settings', { method: 'PUT', body: JSON.stringify(settings) }); setSettings(saved); setSavedSettings(saved); window.dispatchEvent(new CustomEvent('agentdex-settings', { detail: saved })); if ('BroadcastChannel' in window) { const channel = new BroadcastChannel('agentdex-settings'); channel.postMessage(saved); channel.close(); } setFeedback('Settings saved.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save. Retry.'); }
    finally { setBusy(false); }
  }
  async function clear() {
    setBusy(true); setError(''); setFeedback('');
    try {
      const result = await api<ClearMemoryResponse>('/sessions/clear-memory', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('agentdex-memory-cleared', { detail: result.clearedIds }));
      setFeedback(`Cleared ${result.clearedIds.length} ended terminal(s).`);
      if (result.failures.length) setError(`${result.failures.length} terminal(s) could not be cleared. Retry cleanup.`);
      setRetry(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Cleanup failed. Retry.'); }
    finally { setBusy(false); }
  }
  return <main className="flex h-full min-h-0 min-w-0 flex-col"><header className="flex h-14 shrink-0 items-center px-3"><h1 className="text-xs font-medium uppercase tracking-wider">Settings</h1></header><div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto p-3 pt-0 [overflow-wrap:anywhere]">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
    {!settings && !error && <p role="status">Loading settings…</p>}
    {settings && <form id="settings-form" className="min-w-0 space-y-6" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-4"><legend className="mb-3 font-medium">Launch preferences</legend><p className="text-sm text-muted-foreground">Defaults apply to new Agentdex sessions. Resumed conversations keep their provider-saved choices.</p>
      <label className="block space-y-1 text-sm"><span>Default provider</span><Select value={settings.defaultProviderId} onValueChange={defaultProviderId => setSettings({ ...settings, defaultProviderId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(providers.length ? providers : [{ id: 'codex', name: 'Codex' }, { id: 'agy', name: 'Antigravity' }, { id: 'opencode', name: 'OpenCode' }]).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
      <label className="block space-y-1 text-sm"><span>Starting directory</span><input required className={inputClass} value={settings.startingDirectory} onChange={e => setSettings({ ...settings, startingDirectory: e.target.value })} /></label>
      {Object.entries(settings.providers).map(([id, value]) => <ProviderSettings key={id} id={id} name={providers.find(p => p.id === id)?.name ?? id} directory={settings.startingDirectory} value={value} onChange={value => setSettings({ ...settings, providers: { ...settings.providers, [id]: value } })} />)}
      </fieldset>
      <fieldset disabled={busy} className="min-w-0 space-y-3"><legend className="mb-3 font-medium">Terminal</legend>
      <label className="block space-y-1 text-sm"><span>Font size (10–24 px)</span><input type="number" required min={10} max={24} className={inputClass} value={settings.terminal.fontSize} onChange={e => setSettings({ ...settings, terminal: { ...settings.terminal, fontSize: e.target.valueAsNumber } })} /></label>
      <label className="block space-y-1 text-sm"><span>Scrollback (0–10,000 lines)</span><input type="number" required min={0} max={10000} className={inputClass} value={settings.terminal.scrollback} onChange={e => setSettings({ ...settings, terminal: { ...settings.terminal, scrollback: e.target.valueAsNumber } })} /></label><p className="text-xs text-muted-foreground">Font size updates displayed terminals. Scrollback applies to newly created terminals.</p></fieldset>

    </form>}
    <section className="space-y-3 border-t border-border pt-6"><h2 className="font-medium">Terminal memory</h2><p className="text-sm text-muted-foreground">{counts.running} running · {counts.ended} retained ended sessions</p><p className="text-xs text-muted-foreground">Clear ended terminal buffers. Running processes, provider history, files, pins, and Codex learned memories are preserved. Operating-system RAM readings may not drop immediately.</p><Button variant="outline" disabled={busy || !counts.ended} onClick={() => void clear()}>Clear terminal memory</Button></section>
  </div>{settings && <div className="shrink-0 border-t border-border bg-sidebar p-3"><Button form="settings-form" disabled={busy} type="submit">{busy ? 'Working…' : 'Save'}</Button></div>}</main>;
}
