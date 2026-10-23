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
import type { SessionRuntime } from '../models/Session.js';
import HttpError from '../lib/HttpError.js';
import ProviderRegistry from '../lib/providers/index.js';
import resolveExecutable from '../lib/resolveExecutable.js';

const { Terminal } = headless;
const { SerializeAddon } = serialize;

export default class SessionService {
  private current: SessionRuntime | null = null;
  private launching = false;

  constructor(private readonly providers = new ProviderRegistry()) {}

  get session(): Session | null {
    return this.current ? { ...this.current.info } : null;
  }

  getRuntime(id: string): SessionRuntime {
    if (!this.current || this.current.info.id !== id) throw new HttpError(404, 'Session not found.');
    return this.current;
  }

  async create(workingDirectory: unknown, providerId?: unknown): Promise<Session> {
    const provider = this.providers.get(providerId);
    if (this.launching || this.current?.info.status === 'running') {
      throw new HttpError(409, 'Stop the current session before launching another.');
    }
    this.launching = true;
    try {
      const cwd = await this.resolveDirectory(workingDirectory);
      const launch = provider.getLaunchConfig(cwd);
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...launch.env };
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
      this.current?.terminal.dispose();
      const terminal = new Terminal({ cols: 120, rows: 32, scrollback: 2000, allowProposedApi: true });
      const serializer = new SerializeAddon();
      terminal.loadAddon(serializer);
      const runtime: SessionRuntime = {
        info: { id: randomUUID(), provider: provider.id, workingDirectory: cwd, status: 'running', startedAt: new Date().toISOString(), exitCode: null },
        process: child, terminal, serializer, events: new EventEmitter(),
      };
      this.current = runtime;
      child.onData((output) => terminal.write(output, () => runtime.events.emit('output', output)));
      child.onExit(({ exitCode }) => {
        terminal.write('', () => {
          runtime.info.status = 'exited';
          runtime.info.exitCode = exitCode;
          runtime.events.emit('exit', { ...runtime.info });
        });
      });
      return { ...runtime.info };
    } finally {
      this.launching = false;
    }
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
    if (this.current?.info.status === 'running') {
      try { this.current.process.kill('SIGKILL'); } catch { /* Process already exited. */ }
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
