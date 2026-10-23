import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ModelsResponse, ProviderModel, LaunchDefaults } from '@agentdex/shared';
import type ProviderRegistry from '../lib/providers/index.js';
import HttpError from '../lib/HttpError.js';
import resolveExecutable from '../lib/resolveExecutable.js';

const execute = promisify(execFile);
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
export function parseModels(id: string, raw: unknown): ProviderModel[] {
  const result = object(raw);
  let entries: unknown = Array.isArray(raw) ? raw : result.data ?? result.models;
  if (id === 'opencode' && Array.isArray(entries)) {
    entries = entries.map(value => {
      const m = object(value);
      if (typeof m.providerID !== 'string' || typeof m.id !== 'string') throw new Error('Invalid OpenCode model reference.');
      return { ...m, id: `${m.providerID}/${m.id}` };
    });
  }
  if (!Array.isArray(entries)) throw new Error('Provider returned an unsupported model catalog. Enter a custom model ID or check your CLI version.');
  return entries.map(value => {
    const m = typeof value === 'string' ? { id: value } : object(value);
    const modelId = m.model ?? m.id;
    if (typeof modelId !== 'string' || !modelId) throw new Error('Provider returned an invalid model ID.');
    const choices = m.supportedReasoningEfforts ?? m.reasoningEfforts ?? m.efforts ?? m.variants;
    const reasoning = Array.isArray(choices) ? choices.map(v => typeof v === 'string' ? v : object(v).reasoningEffort ?? object(v).id).filter((v): v is string => typeof v === 'string') : Object.keys(object(choices));
    return { id: modelId, label: typeof m.displayName === 'string' ? m.displayName : typeof m.name === 'string' ? m.name : modelId, reasoning, ...(choices === undefined ? { reasoningKnown: false } : {}) };
  });
}

export function parseAntigravityOutput(output: string): unknown {
  try { return JSON.parse(output); } catch { /* Native CLI also exposes a text catalog. */ }
  const lines = output.trim().split(/\r?\n/);
  if (lines.shift()?.trim() !== 'Available models:') throw new Error('Unsupported Antigravity model catalog format. Enter a custom model ID.');
  const models = lines.filter(line => line.trim()).map(line => {
    const match = /^\s+(?:[-*]\s+)?([a-zA-Z0-9][a-zA-Z0-9._:/-]*)(?:\s+[-–]\s+(.+)|\s+\((.+)\))?\s*$/.exec(line);
    if (!match) throw new Error('Unsupported Antigravity model entry. Enter a custom model ID.');
    return { id: match[1], name: match[2] ?? match[3] ?? match[1] };
  });
  return { models };
}

export default class ModelService {
  private readonly cache = new Map<string, { time: number; result: ModelsResponse }>();
  constructor(private readonly providers: ProviderRegistry) {}
  async list(id: string, directory: string, refresh = false): Promise<ModelsResponse> {
    const provider = this.providers.get(id);
    const cwd = directory === '~' ? homedir() : directory.startsWith('~/') ? path.join(homedir(), directory.slice(2)) : directory;
    const config = provider.getLaunchConfig(cwd);
    const key = JSON.stringify([id, cwd, config.executable, process.env.CODEX_HOME, process.env.XDG_CONFIG_HOME, process.env.OPENCODE_CONFIG_DIR, process.env.AGY_HOME]);
    const cached = this.cache.get(key);
    if (!refresh && cached && Date.now() - cached.time < 300000) return cached.result;
    let result: ModelsResponse;
    try {
      const executable = await resolveExecutable(config.executable, process.env.PATH);
      if (!executable) throw new Error(`${provider.name} executable was not found. ${provider.installationHint}`);
      let raw: unknown;
      if (id === 'codex') raw = await this.codex(executable, cwd, config.env);
      else {
        const args = id === 'agy' ? ['models'] : ['api', 'get', `/api/model?location=${encodeURIComponent(JSON.stringify({ directory: cwd }))}`];
        const { stdout } = await execute(executable, args, { cwd, env: { ...process.env, ...config.env }, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
        raw = id === 'agy' ? parseAntigravityOutput(stdout) : JSON.parse(stdout);
      }
      result = { models: parseModels(id, raw), status: 'available' };
    } catch (error) {
      result = { models: [], status: 'unavailable', error: `Model discovery failed: ${error instanceof Error ? error.message.slice(0, 500) : 'Unknown error'}. You can still enter a custom model ID; the provider validates it at launch.` };
    }
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { time: Date.now(), result });
    return result;
  }
  async validate(id: string, directory: string, defaults: LaunchDefaults): Promise<void> {
    if (!defaults.model && !defaults.reasoning) return;
    if (id === 'opencode' && defaults.reasoning && !defaults.model) throw new HttpError(400, 'Choose an OpenCode model before a variant.');
    const catalog = await this.list(id, directory);
    const model = catalog.models.find(m => m.id === defaults.model);
    if (model && model.reasoningKnown !== false && defaults.reasoning && !model.reasoning.includes(defaults.reasoning)) throw new HttpError(400, 'This model does not support the selected reasoning / variant.');
  }
  private codex(executable: string, cwd: string, env?: Record<string, string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
      let buffer = ''; let total = 0; let settled = false;
      let nextId = 2;
      const models: unknown[] = [];
      const cursors = new Set<string>();
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); child.kill('SIGKILL');
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('Codex model discovery timed out')), 15000);
      const send = (id: number, method: string, params: unknown) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      child.on('error', error => finish(error));
      child.on('exit', () => finish(new Error('Codex model discovery disconnected')));
      child.stdin.on('error', error => finish(error));
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) { finish(new Error('Model catalog exceeds output limit')); return; }
        buffer += chunk.toString();
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try {
            const message = object(JSON.parse(line));
            if (message.error) { finish(new Error(String(object(message.error).message ?? 'Codex request failed'))); return; }
            if (message.id === 1) {
              child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
              send(nextId, 'model/list', { includeHidden: false, limit: 100 });
            } else if (message.id === nextId) {
              const result = object(message.result);
              if (!Array.isArray(result.data)) { finish(new Error('Invalid Codex model catalog')); return; }
              models.push(...result.data);
              if (typeof result.nextCursor === 'string' && result.nextCursor) {
                if (cursors.has(result.nextCursor)) { finish(new Error('Codex repeated a model catalog cursor')); return; }
                cursors.add(result.nextCursor);
                send(++nextId, 'model/list', { includeHidden: false, limit: 100, cursor: result.nextCursor });
              } else finish(undefined, { data: models });
            }
          } catch { finish(new Error('Invalid Codex model response')); }
        }
      });
      send(1, 'initialize', { clientInfo: { name: 'agentdex', version: '0.0.0' } });
    });
  }
}

export function launchArguments(id: string, defaults: LaunchDefaults): string[] {
  const { model, reasoning } = defaults;
  if (id === 'opencode') return model ? ['--model', `${model}${reasoning ? `#${reasoning}` : ''}`] : [];
  return [...(model ? ['--model', model] : []), ...(reasoning ? id === 'codex' ? ['--config', `model_reasoning_effort=${JSON.stringify(reasoning)}`] : ['--effort', reasoning] : [])];
}
