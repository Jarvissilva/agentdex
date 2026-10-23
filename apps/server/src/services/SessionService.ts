import SettingsService from './SettingsService.js';
import ModelService, { launchArguments } from './ModelService.js';
import trackMouseEncoding from '../lib/terminalMouse.js';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node-pty';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import type { Session } from '@agentdex/shared';
import { terminalColors } from '@agentdex/shared/terminal-theme.js';
import type { SessionRuntime } from '../models/Session.js';
import trackTaskActivity from '../lib/taskActivity.js';
import HttpError from '../lib/HttpError.js';
import ProviderRegistry from '../lib/providers/index.js';
import resolveExecutable from '../lib/resolveExecutable.js';

const { Terminal } = headless;
const { SerializeAddon } = serialize;

export default class SessionService {
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly launching = new Map<string, number>();
  private readonly resuming = new Map<string, { provider: string; operation: Promise<Session> }>();
  private readonly deleting = new Set<string>();

  constructor(private readonly providers = new ProviderRegistry(), private readonly settings = new SettingsService(), private readonly models = new ModelService(providers)) {}

  get session(): Session | null {
    const latest = [...this.runtimes.values()].at(-1);
    return latest ? { ...latest.info } : null;
  }

  get sessions(): Session[] {
    return [...this.runtimes.values()].map((runtime) => ({ ...runtime.info }));
  }

  getRuntime(id: string): SessionRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new HttpError(404, 'Session not found.');
    return runtime;
  }

  async create(workingDirectory: unknown, providerId?: unknown, resumeSessionId?: unknown): Promise<Session> {
    const preferences = await this.settings.get();
    const provider = this.providers.get(providerId ?? preferences.defaultProviderId);
    workingDirectory ??= preferences.startingDirectory;
    if (resumeSessionId === undefined) return this.launch(workingDirectory, provider.id);
    if (typeof resumeSessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(resumeSessionId)) {
      throw new HttpError(400, 'Invalid saved session ID.');
    }
    const existing = this.sessions.find((session) => session.provider === provider.id && session.providerSessionId === resumeSessionId && session.status === 'running');
    if (existing) return existing;
    const key = JSON.stringify([provider.id, resumeSessionId]);
    const pending = this.resuming.get(key);
    if (pending) return pending.operation;
    const operation = (async () => {
      if (!provider.getResumeConfig) throw new HttpError(400, 'This provider does not support resuming saved sessions.');
      const history = await provider.listSessions().catch((error: unknown) => {
        throw new HttpError(502, error instanceof Error ? error.message : 'Unable to find saved sessions.');
      });
      const saved = history.find((session) => session.id === resumeSessionId);
      if (!saved) throw new HttpError(404, 'Saved session not found. Refresh the sessions explorer.');
      return this.launch(saved.workingDirectory, provider.id, resumeSessionId);
    })();
    this.resuming.set(key, { provider: provider.id, operation });
    try { return await operation; }
    finally { this.resuming.delete(key); }
  }

  private async launch(workingDirectory: unknown, providerId: string, providerSessionId?: string): Promise<Session> {
    const provider = this.providers.get(providerId);
    if (this.deleting.has(provider.id)) {
      throw new HttpError(409, 'Wait for the provider session deletion to finish before launching.');
    }
    this.launching.set(provider.id, (this.launching.get(provider.id) ?? 0) + 1);
    try {
      const cwd = await this.resolveDirectory(workingDirectory);
      const launch = providerSessionId ? provider.getResumeConfig?.(cwd, providerSessionId) : provider.getLaunchConfig(cwd);
      if (!launch) throw new HttpError(400, 'This provider does not support resuming saved sessions.');
      const preferences = await this.settings.get();
      if (!providerSessionId) {
        const defaults = preferences.providers[provider.id];
        if (defaults) {
          await this.models.validate(provider.id, cwd, defaults);
          launch.args = [...launch.args, ...launchArguments(provider.id, defaults)];
        }
      }
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
      // An interactive PTY supports color even if the server was launched by a
      // runner that disables colors for its own logs. Preserve provider overrides.
      delete env.NO_COLOR;
      Object.assign(env, launch.env);
      const executable = await resolveExecutable(launch.executable, env.PATH);
      if (!executable) throw new HttpError(503, `${provider.name} was not found. ${provider.installationHint}`);
      let child;
      try {
        child = spawn(executable, launch.args, {
          name: 'xterm-256color', cwd, cols: 120, rows: 32,
          env,
        });
      } catch {
        throw new HttpError(503, `Unable to start ${provider.name}. ${provider.installationHint}`);
      }
      const terminal = new Terminal({ cols: 120, rows: 32, scrollback: preferences.terminal.scrollback, allowProposedApi: true });
      // Providers probe colors during startup, often before any browser connects.
      // Headless xterm parses OSC but has no renderer to answer these queries.
      for (const command of [10, 11, 12] as const) {
        const color = terminalColors[command].slice(1).match(/../g)!.map((channel) => channel.repeat(2)).join('/');
        terminal.parser.registerOscHandler(command, (data) => {
          if (data !== '?') return false;
          child.write(`\x1b]${command};rgb:${color}\x1b\\`);
          return true;
        });
      }
      const serializer = new SerializeAddon();
      terminal.loadAddon(serializer);
      const runtime: SessionRuntime = {
        info: { id: randomUUID(), ...(providerSessionId ? { providerSessionId } : {}), provider: provider.id, workingDirectory: cwd, status: 'running', taskActivity: 'unknown', startedAt: new Date().toISOString(), exitCode: null },
        process: child, terminal, serializer, mouseEncoding: trackMouseEncoding(terminal), dispose: () => {}, events: new EventEmitter(),
      };
      const clearActivity = ['codex', 'opencode', 'agy'].includes(provider.id)
        ? trackTaskActivity(terminal, (data) => child.write(data), (activity) => { runtime.info.taskActivity = activity; })
        : () => {};
      this.runtimes.set(runtime.info.id, runtime);
      const dataListener = child.onData((output) => terminal.write(output, () => runtime.events.emit('output', output)));
      const exitListener = child.onExit(({ exitCode }) => {
        terminal.write('', () => {
          clearActivity();
          runtime.info.status = 'exited';
          runtime.info.exitCode = exitCode;
          runtime.events.emit('exit', { ...runtime.info });
        });
      });
      runtime.dispose = () => {
        dataListener.dispose(); exitListener.dispose(); clearActivity();
        runtime.events.emit('removed'); runtime.events.removeAllListeners();
        terminal.dispose();
      };
      return { ...runtime.info };
    } finally {
      const remaining = (this.launching.get(provider.id) ?? 1) - 1;
      if (remaining) this.launching.set(provider.id, remaining);
      else this.launching.delete(provider.id);
    }
  }

  clearMemory() {
    const clearedIds: string[] = [];
    const failures: { id: string; error: string }[] = [];
    for (const [id, runtime] of this.runtimes) {
      if (runtime.info.status !== 'exited') continue;
      try { runtime.dispose(); this.runtimes.delete(id); clearedIds.push(id); }
      catch { failures.push({ id, error: 'Unable to clear this terminal. Retry cleanup.' }); }
    }
    return { clearedIds, failures };
  }

  async deleteHistory(provider: string, operation: () => Promise<void>): Promise<void> {
    this.providers.get(provider);
    if ([...this.resuming.values()].some((entry) => entry.provider === provider) || this.launching.has(provider) || this.deleting.has(provider) || this.sessions.some((session) => session.provider === provider && session.status === 'running')) {
      throw new HttpError(409, 'Stop the provider terminal before deleting saved sessions, or wait for the current operation.');
    }
    this.deleting.add(provider);
    try { await operation(); } finally { this.deleting.delete(provider); }
  }

  stop(id: string): void {
    const runtime = this.getRuntime(id);
    if (runtime.info.status === 'exited') return;
    runtime.process.kill('SIGTERM');
    const timeout = setTimeout(() => {
      if (runtime.info.status === 'running') {
        try { runtime.process.kill('SIGKILL'); } catch { /* Process already exited. */ }
      }
    }, 2000);
    timeout.unref();
  }

  shutdown(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.info.status === 'running') {
        try { runtime.process.kill('SIGKILL'); } catch { /* Process already exited. */ }
      }
    }
  }

  private async resolveDirectory(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Enter a working directory.');
    let directory = value.trim();
    if (directory === '~') directory = homedir();
    else if (directory.startsWith('~/')) directory = path.join(homedir(), directory.slice(2));
    if (!path.isAbsolute(directory)) throw new HttpError(400, 'Use an absolute directory path or ~/path.');
    try {
      directory = await realpath(directory);
      if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory');
      await access(directory, constants.R_OK | constants.X_OK);
      return directory;
    } catch {
      throw new HttpError(400, 'The working directory does not exist or is not accessible.');
    }
  }
}
