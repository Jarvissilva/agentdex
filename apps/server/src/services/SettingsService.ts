import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Settings } from '@agentdex/shared';
import { dataPath } from '../lib/dataPath.js';
import HttpError from '../lib/HttpError.js';

export default class SettingsService {
  constructor(private readonly file = path.join(dataPath, 'settings.json'), private readonly directory = process.env.INIT_CWD ?? homedir()) {}
  defaults(): Settings {
    return { defaultProviderId: 'codex', startingDirectory: this.directory, providers: Object.fromEntries(['codex', 'agy', 'opencode'].map(id => [id, { model: '', reasoning: '' }])), terminal: { fontSize: 14, scrollback: 2000 } };
  }
  validate(value: unknown): Settings {
    const invalid = () => new HttpError(400, 'Invalid settings. Check provider, directory, model, reasoning, and terminal limits.');
    if (!value || typeof value !== 'object') throw invalid();
    const s = value as Settings;
    const text = (v: unknown) => typeof v === 'string' && v.length <= 4096 && ![...v].some(character => character.charCodeAt(0) < 32);
    if (!['codex', 'agy', 'opencode'].includes(s.defaultProviderId) || !text(s.startingDirectory) || !s.startingDirectory.trim() || !(path.isAbsolute(s.startingDirectory) || s.startingDirectory === '~' || s.startingDirectory.startsWith('~/')) || !s.providers || !s.terminal) throw invalid();
    for (const id of ['codex', 'agy', 'opencode']) {
      const p = s.providers[id];
      if (!p || !text(p.model) || !text(p.reasoning) || (id === 'opencode' && p.reasoning && !p.model) || (id === 'opencode' && p.model && (!p.model.includes('/') || p.model.includes('#')))) throw invalid();
    }
    if (!Number.isInteger(s.terminal.fontSize) || s.terminal.fontSize < 10 || s.terminal.fontSize > 24 || !Number.isInteger(s.terminal.scrollback) || s.terminal.scrollback < 0 || s.terminal.scrollback > 10000) throw invalid();
    return { defaultProviderId: s.defaultProviderId, startingDirectory: s.startingDirectory.trim(), providers: Object.fromEntries(['codex', 'agy', 'opencode'].map(id => [id, { model: s.providers[id]!.model.trim(), reasoning: s.providers[id]!.reasoning.trim() }])), terminal: { ...s.terminal } };
  }
  async get(): Promise<Settings> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults(); throw error; }
    try { return this.validate(JSON.parse(raw)); }
    catch { throw new HttpError(500, 'Stored settings are malformed. Repair settings.json before saving preferences.'); }
  }
  async save(value: unknown): Promise<Settings> {
    const settings = this.validate(value);
    await this.get();
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, this.file); }
    finally { await unlink(temporary).catch(() => {}); }
    return settings;
  }
}
