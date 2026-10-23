import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import { parse, modify, applyEdits, type ParseError } from 'jsonc-parser';
import type { Destination, LibraryInput, LibraryItem, LibraryKind, PublicationStatus } from '@agentdex/shared';
import { dataPath } from '../lib/dataPath.js';
import HttpError from '../lib/HttpError.js';

const launcherSource = `const fs = require('node:fs');\nconst { spawn } = require('node:child_process');\nconst d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));\nif (!d.enabled) process.exit(0);\nconst child = spawn(d.command, d.args || [], { cwd: d.cwd, env: { ...process.env, ...d.env }, stdio: 'inherit' });\nchild.on('error', () => process.exit(1));\nfor (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));\nchild.on('exit', code => process.exit(code ?? 1));\n`;

interface Installation { destination: Destination; path: string; fingerprint: string; revision: string; snapshotFingerprint?: string }
interface RecordItem extends LibraryInput { id: string; nativeName: string; publications: Installation[]; folderRevision?: string }
interface Catalog { skills: RecordItem[]; mcps: RecordItem[] }
interface Options { root?: string; home?: string; codexHome?: string; configHome?: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const exists = async (file: string) => !!await fs.lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
const conflict = () => new HttpError(409, 'Unmanaged or externally modified publication.');
const validMap = (value: unknown): value is Record<string, string> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');

export default class LibraryService {
  readonly root: string;
  private readonly home: string;
  private readonly codexHome: string;
  private readonly configHome: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(options: Options = {}) {
    this.root = options.root ?? dataPath;
    this.home = options.home ?? homedir();
    this.codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(this.home, '.codex');
    this.configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? path.join(this.home, '.config');
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async atomic(file: string, content: string) {
    if (file.startsWith(this.root + path.sep)) { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); await fs.chmod(this.root, 0o700); }
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, content, { mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }); }
  }
  private async read(): Promise<Catalog> {
    try { return JSON.parse(await fs.readFile(path.join(this.root, 'catalog.json'), 'utf8')) as Catalog; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { skills: [], mcps: [] }; throw error; }
  }
  private save(catalog: Catalog) { return this.atomic(path.join(this.root, 'catalog.json'), JSON.stringify(catalog, null, 2)); }
  private folder(item: RecordItem) { return path.join(this.root, 'skills', item.nativeName, item.folderRevision ?? ''); }
  private validate(input: LibraryInput, old?: RecordItem): LibraryInput {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new HttpError(400, 'A display name is required (maximum 200 characters).');
    if (input.definition) {
      const d = input.definition;
      if (!['stdio', 'http'].includes(d.transport) || typeof d.enabled !== 'boolean' || (d.args !== undefined && (!Array.isArray(d.args) || !d.args.every(a => typeof a === 'string'))) || (d.cwd !== undefined && (typeof d.cwd !== 'string' || !path.isAbsolute(d.cwd)))) throw new HttpError(400, 'Invalid MCP definition.');
      if (d.transport === 'stdio' && (typeof d.command !== 'string' || !d.command.trim())) throw new HttpError(400, 'A command is required.');
      if (d.transport === 'http') { try { if (!['http:', 'https:'].includes(new URL(d.url ?? '').protocol)) throw Error(); } catch { throw new HttpError(400, 'An HTTP URL is required.'); } }
      for (const field of ['env', 'headers'] as const) {
        if (d[field] !== undefined && !validMap(d[field])) throw new HttpError(400, `Invalid ${field}.`);
        if (d[field]) d[field] = Object.fromEntries(Object.entries(d[field]).map(([key, value]) => [key, value === '••••••' ? old?.definition?.[field]?.[key] ?? '' : value]));
      }
      const definition = d.transport === 'stdio'
        ? { transport: d.transport, enabled: d.enabled, command: d.command, args: d.args, env: d.env, cwd: d.cwd }
        : { transport: d.transport, enabled: d.enabled, url: d.url, headers: d.headers };
      return { name: input.name.trim(), definition };
    }
    if (typeof input.content !== 'string') throw new HttpError(400, 'SKILL.md content is required.');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(input.content);
    let front: unknown;
    try { front = match && parseYaml(match[1] ?? ''); } catch { throw new HttpError(400, 'Invalid YAML frontmatter.'); }
    if (!front || typeof front !== 'object' || !('name' in front) || typeof front.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(front.name) || front.name.length > 64 || !('description' in front) || typeof front.description !== 'string' || !front.description.trim()) throw new HttpError(400, 'Frontmatter requires a lowercase hyphenated name and description.');
    return { name: input.name.trim(), content: input.content };
  }
  private async tree(folder: string): Promise<string> {
    if ((await fs.lstat(folder)).isSymbolicLink()) throw new HttpError(400, 'Skill folders cannot be symlinks.');
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const parts: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new HttpError(400, 'Skill folders cannot contain symlinks or special files.');
      parts.push(entry.name, entry.isDirectory() ? await this.tree(file) : hash((await fs.readFile(file)).toString('base64')));
    }
    return hash(JSON.stringify(parts));
  }
  private async revision(item: RecordItem) { return item.definition ? hash(JSON.stringify(item.definition)) : this.tree(this.folder(item)); }
  private destinations(kind: LibraryKind): Destination[] { return kind === 'skills' ? ['agents', 'antigravity'] : ['codex', 'antigravity', 'opencode']; }
  private async target(kind: LibraryKind, item: RecordItem, destination: Destination): Promise<string> {
    if (kind === 'skills') return path.join(this.home, destination === 'agents' ? '.agents/skills' : '.gemini/antigravity-cli/skills', item.nativeName);
    if (destination === 'codex') return path.join(this.codexHome, 'config.toml');
    if (destination === 'antigravity') return path.join(this.home, '.gemini/config/mcp_config.json');
    const json = path.join(this.configHome, 'opencode/opencode.json');
    const jsonc = `${json}c`;
    if (await exists(json) && await exists(jsonc)) throw new HttpError(409, 'Both OpenCode JSON and JSONC configuration files exist.');
    return await exists(jsonc) ? jsonc : json;
  }
  private async config(file: string, destination: Destination, name: string) {
    if ((await fs.lstat(file).catch(() => null))?.isSymbolicLink()) throw conflict();
    const text = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
    if (destination === 'codex') {
      let parsed: ReturnType<typeof parseToml>;
      try { parsed = parseToml(text); } catch { throw new HttpError(409, 'Malformed TOML configuration.'); }
      const servers = parsed.mcp_servers as Record<string, unknown> | undefined;
      return { text, value: servers?.[name] };
    }
    const errors: ParseError[] = [];
    const parsed: unknown = parse(text || '{}', errors, { allowTrailingComma: true });
    if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(409, 'Malformed provider configuration.');
    const section = (parsed as Record<string, unknown>)[destination === 'opencode' ? 'mcp' : 'mcpServers'];
    if (section !== undefined && (!section || typeof section !== 'object' || Array.isArray(section))) throw conflict();
    return { text, value: (section as Record<string, unknown> | undefined)?.[name] };
  }
  private async fingerprint(kind: LibraryKind, item: RecordItem, destination: Destination, file: string): Promise<string | undefined> {
    if (kind === 'mcps') { const { value } = await this.config(file, destination, item.nativeName); return value === undefined ? undefined : hash(JSON.stringify(value)); }
    if (!await exists(file)) return undefined;
    const stat = await fs.lstat(file);
    if (destination === 'agents') {
      if (!stat.isSymbolicLink()) return 'unmanaged';
      const target = await fs.readlink(file);
      if (!target.startsWith(path.join(this.root, 'skills', item.nativeName) + path.sep)) return 'unmanaged';
      return hash(target + await this.tree(target));
    }
    return stat.isDirectory() && !stat.isSymbolicLink() ? this.tree(file) : 'unmanaged';
  }
  private snapshot(item: RecordItem, destination: Destination) { return path.join(this.root, 'publications', `${item.id}-${destination}.json`); }
  private async snapshotIntact(item: RecordItem, owned: Installation | undefined) {
    if (!owned?.snapshotFingerprint) return true;
    const content = await fs.readFile(this.snapshot(item, owned.destination), 'utf8').catch(() => undefined);
    if (content === undefined || hash(content) !== owned.snapshotFingerprint) return false;
    if ((JSON.parse(content) as { transport: string }).transport === 'stdio') {
      return await fs.readFile(path.join(this.root, 'launcher.cjs'), 'utf8').catch(() => undefined) === launcherSource;
    }
    return true;
  }
  private async status(kind: LibraryKind, item: RecordItem, destination: Destination): Promise<PublicationStatus> {
    try {
      const file = await this.target(kind, item, destination);
      const fingerprint = await this.fingerprint(kind, item, destination, file);
      const owned = item.publications.find(p => p.destination === destination);
      const status = owned && owned.path !== file ? 'conflict' : fingerprint === undefined ? 'missing' : !owned || owned.path !== file || owned.fingerprint !== fingerprint || !await this.snapshotIntact(item, owned) ? 'conflict' : owned.revision !== await this.revision(item) ? 'outdated' : 'installed';
      return { destination, status };
    } catch (error) { return { destination, status: error instanceof HttpError && error.status === 409 ? 'conflict' : 'error', message: error instanceof HttpError ? error.message : 'Cannot read publication or provider configuration.' }; }
  }
  async list(kind: LibraryKind): Promise<LibraryItem[]> {
    await this.queue;
    const catalog = await this.read();
    return Promise.all(catalog[kind].map(async item => ({ id: item.id, nativeName: item.nativeName, name: item.name, content: item.content, definition: item.definition && { ...item.definition, env: item.definition.env && Object.fromEntries(Object.keys(item.definition.env).map(k => [k, '••••••'])), headers: item.definition.headers && Object.fromEntries(Object.keys(item.definition.headers).map(k => [k, '••••••'])) }, installations: await Promise.all(this.destinations(kind).map(d => this.status(kind, item, d))) })));
  }
  put(kind: LibraryKind, input: LibraryInput, id?: string, source?: string) {
    return this.serialized(async () => {
      const catalog = await this.read();
      const old = id ? catalog[kind].find(i => i.id === id) : undefined;
      if (id && !old) throw new HttpError(404, 'Library item not found.');
      if (source) {
        if (kind !== 'skills' || typeof source !== 'string' || !path.isAbsolute(source) || (await fs.lstat(source)).isSymbolicLink()) throw new HttpError(400, 'Import requires an absolute folder path.');
        await this.tree(source);
        input = { name: input.name, content: await fs.readFile(path.join(source, 'SKILL.md'), 'utf8') };
      }
      if (!input || typeof input !== 'object') throw new HttpError(400, 'A library item is required.');
      if ((kind === 'mcps') !== !!input.definition) throw new HttpError(400, 'Invalid library item type.');
      const validated = this.validate(input, old);
      const skillName = kind === 'skills' ? (parseYaml(/^---\r?\n([\s\S]*?)\r?\n---/.exec(validated.content!)![1]!) as { name: string }).name : undefined;
      if (skillName && old && skillName !== old.nativeName) throw new HttpError(400, 'The skill frontmatter name is immutable; change the display name instead.');
      if (skillName && !old && catalog.skills.some(item => item.nativeName === skillName)) throw new HttpError(409, 'A skill with this native name already exists.');
      const item: RecordItem = { ...validated, id: old?.id ?? randomUUID(), nativeName: old?.nativeName ?? skillName ?? `agentdex-${randomUUID()}`, publications: old?.publications ?? [], ...(kind === 'skills' ? { folderRevision: randomUUID() } : {}) };
      if (kind === 'skills') {
        const stage = path.join(this.root, 'skills', `.stage-${randomUUID()}`);
        await fs.mkdir(path.dirname(stage), { recursive: true, mode: 0o700 });
        try {
          if (source || old) {
            const origin = source ?? this.folder(old!);
            await this.tree(origin);
            await fs.cp(origin, stage, { recursive: true, dereference: false });
            await this.tree(stage);
          } else await fs.mkdir(stage, { mode: 0o700 });
          await this.atomic(path.join(stage, 'SKILL.md'), item.content!);
          await fs.mkdir(path.dirname(this.folder(item)), { recursive: true, mode: 0o700 });
          await fs.rename(stage, this.folder(item));
        } finally { await fs.rm(stage, { recursive: true, force: true }); }
      } else await this.atomic(path.join(this.root, 'mcps', `${item.id}.json`), JSON.stringify(item.definition));
      catalog[kind] = [...catalog[kind].filter(i => i.id !== item.id), item];
      await this.save(catalog);
      return item.id;
    });
  }
  private native(item: RecordItem, destination: Destination): Record<string, unknown> {
    const d = item.definition!;
    if (d.transport === 'http') {
      if (destination === 'codex') return { url: d.url!, enabled: d.enabled, http_headers: d.headers ?? {} };
      if (destination === 'opencode') return { type: 'remote', url: d.url!, enabled: d.enabled, headers: d.headers ?? {} };
      if (!d.enabled) return { serverUrl: d.url!, headers: d.headers ?? {}, disabled: true };
      return { serverUrl: d.url!, headers: d.headers ?? {} };
    }
    const args = [path.join(this.root, 'launcher.cjs'), path.join(this.root, 'publications', `${item.id}-${destination}.json`)];
    if (destination === 'opencode') return { type: 'local', command: [process.execPath, ...args], enabled: d.enabled };
    return { command: process.execPath, args, ...(destination === 'codex' ? { enabled: d.enabled } : { disabled: !d.enabled }) };
  }
  private async writeConfig(file: string, destination: Destination, item: RecordItem, value: Record<string, unknown> | undefined) {
    const before = await this.config(file, destination, item.nativeName);
    let next: string;
    if (destination === 'codex') {
      // Bound edits to this server's parsed table, including its nested tables.
      const lines = before.text.split(/(?<=\n)/);
      let removing = false;
      const kept = lines.filter(line => {
        if (/^\s*\[/.test(line)) {
          const header = /^\s*\[\[?\s*(.*?)\s*\]\]?\s*(?:#.*)?(?:\r?\n)?$/.exec(line)?.[1];
          removing = !!header && (header === `mcp_servers.${item.nativeName}` || header.startsWith(`mcp_servers.${item.nativeName}.`) || header === `mcp_servers."${item.nativeName}"` || header.startsWith(`mcp_servers."${item.nativeName}".`));
        }
        return !removing;
      }).join('');
      next = kept + (value ? `\n${stringifyToml({ mcp_servers: { [item.nativeName]: value } } as Parameters<typeof stringifyToml>[0])}` : '');
      const parsed = parseToml(next);
      const expected = value === undefined ? undefined : JSON.stringify(value);
      if (JSON.stringify((parsed.mcp_servers as Record<string, unknown> | undefined)?.[item.nativeName]) !== expected) throw conflict();
      const original = parseToml(before.text);
      for (const doc of [original, parsed]) { const servers = doc.mcp_servers as Record<string, unknown> | undefined; if (servers) { delete servers[item.nativeName]; if (!Object.keys(servers).length) delete doc.mcp_servers; } }
      if (JSON.stringify(original) !== JSON.stringify(parsed)) throw conflict();
    } else next = applyEdits(before.text || '{}', modify(before.text || '{}', [destination === 'opencode' ? 'mcp' : 'mcpServers', item.nativeName], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    if ((await this.config(file, destination, item.nativeName)).text !== before.text) throw conflict();
    await this.atomic(file, next);
  }
  private async publish(kind: LibraryKind, item: RecordItem, destination: Destination, uninstall: boolean) {
    const file = await this.target(kind, item, destination);
    const current = await this.fingerprint(kind, item, destination, file);
    const owned = item.publications.find(p => p.destination === destination);
    if (owned && owned.path !== file) throw conflict();
    if (!await this.snapshotIntact(item, owned)) throw conflict();
    if (current !== undefined && (!owned || owned.path !== file || owned.fingerprint !== current)) throw conflict();
    if (kind === 'mcps') {
      if (uninstall) { if (current !== undefined) await this.writeConfig(file, destination, item, undefined); }
      else {
        const launcher = path.join(this.root, 'launcher.cjs');
        const previousLauncher = await fs.readFile(launcher, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (previousLauncher !== undefined && previousLauncher !== launcherSource) throw conflict();
        await this.atomic(launcher, launcherSource);
        const snapshot = path.join(this.root, 'publications', `${item.id}-${destination}.json`);
        const previous = await fs.readFile(snapshot, 'utf8').catch(() => undefined);
        await this.atomic(snapshot, JSON.stringify(item.definition));
        try { await this.writeConfig(file, destination, item, this.native(item, destination)); }
        catch (error) { if (previous === undefined) await fs.rm(snapshot, { force: true }); else await this.atomic(snapshot, previous); throw error; }
      }
    } else {
      if (uninstall) { if (current !== undefined) await fs.rm(file, { recursive: destination !== 'agents', force: true }); }
      else {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const stage = `${file}.${randomUUID()}.tmp`;
        const backup = `${file}.${randomUUID()}.old`;
        try {
          if (destination === 'agents') await fs.symlink(this.folder(item), stage, 'dir');
          else { await this.tree(this.folder(item)); await fs.cp(this.folder(item), stage, { recursive: true }); }
          if (await this.fingerprint(kind, item, destination, file) !== current) throw conflict();
          if (current !== undefined) await fs.rename(file, backup);
          try { await fs.rename(stage, file); } catch (error) { if (current !== undefined) await fs.rename(backup, file); throw error; }
          await fs.rm(backup, { recursive: true, force: true });
        } finally { await fs.rm(stage, { recursive: true, force: true }); }
      }
    }
    if (uninstall && kind === 'mcps') await fs.rm(path.join(this.root, 'publications', `${item.id}-${destination}.json`), { force: true });
    item.publications = item.publications.filter(p => p.destination !== destination);
    if (!uninstall) item.publications.push({ destination, path: file, fingerprint: (await this.fingerprint(kind, item, destination, file))!, revision: await this.revision(item), ...(kind === 'mcps' ? { snapshotFingerprint: hash(await fs.readFile(this.snapshot(item, destination), 'utf8')) } : {}) });
  }
  sync(kind: LibraryKind, id: string, destinations: Destination[], uninstall = false) {
    return this.serialized(async () => {
      if (!Array.isArray(destinations) || !destinations.length || !destinations.every(d => this.destinations(kind).includes(d))) throw new HttpError(400, 'Select valid destinations.');
      const catalog = await this.read();
      const item = catalog[kind].find(i => i.id === id);
      if (!item) throw new HttpError(404, 'Library item not found.');
      const results: PublicationStatus[] = [];
      for (const destination of new Set(destinations)) {
        try { await this.publish(kind, item, destination, uninstall); await this.save(catalog); results.push(await this.status(kind, item, destination)); }
        catch (error) { results.push({ destination, status: error instanceof HttpError && error.status === 409 ? 'conflict' : 'error', message: error instanceof HttpError ? error.message : 'Publication could not be changed safely.' }); }
      }
      return results;
    });
  }
  remove(kind: LibraryKind, id: string) {
    return this.serialized(async () => {
      const catalog = await this.read();
      const item = catalog[kind].find(i => i.id === id);
      if (!item) throw new HttpError(404, 'Library item not found.');
      for (const publication of [...item.publications]) { await this.publish(kind, item, publication.destination, true); await this.save(catalog); }
      if (kind === 'skills') await fs.rm(path.join(this.root, 'skills', item.nativeName), { recursive: true, force: true });
      else await fs.rm(path.join(this.root, 'mcps', `${id}.json`), { force: true });
      catalog[kind] = catalog[kind].filter(i => i.id !== id);
      await this.save(catalog);
    });
  }
}
