import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Command, FolderOpen, LoaderCircle, TerminalSquare } from 'lucide-react';
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import type { ProvidersResponse, Session, SessionsResponse } from '@agentdex/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { api, ApiRequestError } from '@/lib/api';
import JarvisOrb from '@/components/ui/JarvisOrb';

export async function homeLoader({ request }: LoaderFunctionArgs) {
  const [sessions, providers] = await Promise.all([
    api<SessionsResponse>('/sessions', { signal: request.signal }),
    api<ProvidersResponse>('/providers', { signal: request.signal }),
  ]);
  return { ...sessions, ...providers };
}

export default function Home() {
  const { providers, defaultProviderId, defaultWorkingDirectory, homeDirectory, discoveryErrors } = useLoaderData<typeof homeLoader>();
  const navigate = useNavigate();
  const errors = new Map(discoveryErrors.map((issue) => [issue.provider, issue.error]));
  const readyProviders = providers.filter((p) => !errors.has(p.id));

  const [selectedProvider, setSelectedProvider] = useState(defaultProviderId);
  const [workingDirectory, setWorkingDirectory] = useState(defaultWorkingDirectory);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const picker = useRef<AbortController | null>(null);
  const pending = launching || picking;

  useEffect(() => () => picker.current?.abort(), []);

  async function browse() {
    if (picker.current) return;
    const controller = new AbortController();
    picker.current = controller;
    setPicking(true);
    setPickerError('');
    try {
      const result = await api<{ directory: string | null }>('/sessions/pick-directory', {
        method: 'POST',
        body: JSON.stringify({ workingDirectory }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted && result.directory !== null) {
        setWorkingDirectory(result.directory);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setPickerError(error instanceof Error ? error.message : 'Unable to open the folder picker.');
      }
    } finally {
      picker.current = null;
      if (!controller.signal.aborted) setPicking(false);
    }
  }

  async function launch() {
    if (pending || !readyProviders.length) return;
    setLaunching(true);
    setLaunchError('');

    try {
      const created = await api<Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedProvider, workingDirectory }),
      });
      void navigate('/sessions', { state: { activeTab: created.id } });
    } catch (error) {
      setLaunchError(error instanceof ApiRequestError ? error.message : 'Failed to launch session.');
      setLaunching(false);
    }
  }

  const displayDirectory = workingDirectory && homeDirectory && (workingDirectory === homeDirectory || workingDirectory.startsWith(`${homeDirectory}/`))
    ? `~${workingDirectory.slice(homeDirectory.length)}`
    : workingDirectory;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground">
      <title>AgentDex</title>

      <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-5 sm:px-10 sm:py-7">
        <Link to="/" className="flex items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-8 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-400/10 text-blue-300">
            <Command className="size-4" aria-hidden="true" />
          </span>
          AgentDex
        </Link>
        <Link to="/sessions" className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <TerminalSquare className="size-3.5" aria-hidden="true" />
          Sessions
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-5 pt-2 pb-12 sm:px-8">
        <div className="w-full max-w-xl">
          <div className="pointer-events-none relative mx-auto flex h-40 items-center justify-center sm:h-48" aria-hidden="true">
            <JarvisOrb />
          </div>

          <div className="relative mb-8 text-center">
            <p className="mb-3 font-mono text-[10px] font-medium tracking-[0.2em] text-blue-300/80 uppercase">Your local agent workspace</p>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[2.75rem] sm:leading-tight">Good work starts here.</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Pick your agent. Open a project. Build something.</p>
          </div>

          <form
            onSubmit={(event) => { event.preventDefault(); void launch(); }}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-black/10 transition-colors focus-within:border-blue-400/40"
          >
            <div className="px-5 pt-5 pb-4 sm:px-6">
              <label htmlFor="home-directory" className="mb-3 block text-xs font-medium text-muted-foreground">Project directory</label>
              <div className="flex items-center gap-3">
                <FolderOpen className="size-5 shrink-0 text-blue-300/80" aria-hidden="true" />
                <input
                  id="home-directory"
                  type="text"
                  value={workingDirectory}
                  onChange={(event) => setWorkingDirectory(event.target.value)}
                  placeholder="~/projects/your-project"
                  disabled={pending}
                  required
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="home-directory-hint"
                  className="h-9 w-full min-w-0 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                />
                <button
                  type="button"
                  onClick={() => void browse()}
                  disabled={pending}
                  aria-label="Browse for project directory"
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {picking ? 'Choosing…' : 'Browse'}
                </button>
              </div>
              <p id="home-directory-hint" className="mt-2 text-xs leading-5 text-muted-foreground/70">Enter a project path or browse for a folder.</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/30 px-5 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <span className="relative flex size-1.5 shrink-0 rounded-full bg-blue-300/70" aria-hidden="true" />
                <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={pending || !readyProviders.length}>
                  <SelectTrigger aria-label="Agent provider" className="h-8 w-auto max-w-48 border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {readyProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="submit"
                disabled={pending || !readyProviders.length || !workingDirectory.trim()}
                className="flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-200 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40"
              >
                {launching ? 'Starting…' : 'Start session'}
                {launching ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight className="size-3.5" aria-hidden="true" />}
              </button>
            </div>
          </form>

          {(pickerError || launchError) && <p role="alert" className="mt-3 text-center text-xs text-destructive">{pickerError || launchError}</p>}
          {!readyProviders.length && <p role="status" className="mt-3 text-center text-xs text-muted-foreground">No agents are available. Check your provider configuration to start a session.</p>}

          <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
            <TerminalSquare className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Already have something in progress? <Link to="/sessions" className="rounded-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open sessions</Link></span>
          </p>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 px-6 py-3 font-mono text-[10px] text-muted-foreground/60 sm:px-10">
        <span>Local agents. Your workspace.</span>
        <span className="max-w-full truncate" title={workingDirectory}>{displayDirectory || 'No project selected'}</span>
      </footer>
    </section>
  );
}
