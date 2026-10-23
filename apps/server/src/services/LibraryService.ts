import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import { parse, modify, applyEdits, type ParseError } from 'jsonc-parser';
import type { Destination, LibraryInput, LibraryItem, LibraryKind, McpDefinition, SyncRequest, PublicationStatus } from '@agentdex/shared';
import { dataPath } from '../lib/dataPath.js';
import HttpError from '../lib/HttpError.js';
import { credentialMask, maskDefinition, credentialValues, providerEntry, providerCredentials, withoutCredentialValues, type McpCredentials } from '../lib/mcpCredentials.js';

const launcherSource = `const fs = require('node:fs');\nconst { spawn } = require('node:child_process');\nconst d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));\nif (!d.enabled) process.exit(0);\nconst child = spawn(d.command, d.args || [], { cwd: d.cwd, env: { ...process.env, ...d.env }, stdio: 'inherit' });\nchild.on('error', () => process.exit(1));\nfor (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));\nchild.on('exit', code => process.exit(code ?? 1));\n`;

interface Installation { destination: Destination; path: string; fingerprint: string; revision: string; snapshotFingerprint?: string; nativeName?: string; snapshotPath?: string }
interface RecordItem extends LibraryInput { id: string; nativeName: string; publications: Installation[]; folderRevision?: string; credentialRevision?: string; originalName?: string }
interface Catalog { skills: RecordItem[]; mcps: RecordItem[]; agents: RecordItem[] }
interface Options { root?: string; home?: string; codexHome?: string; configHome?: string }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
  return entry;
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const exists = async (file: string) => !!await fs.lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
const conflict = () => new HttpError(409, 'Unmanaged or externally modified publication.');
const validMap = (value: unknown): value is Record<string, string> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');

export default class LibraryService {
  readonly root: string;
  private readonly home: string;
  private readonly codexHome: string;
  private readonly configHome: string;
  private readonly pendingCredentials = new Map<string, McpCredentials>();
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
    try { const catalog = JSON.parse(await fs.readFile(path.join(this.root, 'catalog.json'), 'utf8')) as Catalog; return { ...catalog, agents: catalog.agents ?? [] }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { skills: [], mcps: [], agents: [] }; throw error; }
  }
  private save(catalog: Catalog) { return this.atomic(path.join(this.root, 'catalog.json'), JSON.stringify(catalog, null, 2)); }
  private safeName(name: string) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_. -]{0,199}$/.test(name) || /[. ]$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new HttpError(400, 'Unsafe MCP name. Use letters, numbers, spaces, underscores, dots or hyphens.');
    return name;
  }
  private mcpFolder(item: RecordItem) { return path.join(this.root, 'mcps', this.safeName(item.originalName ?? item.nativeName)); }
  private published(item: RecordItem, destination: Destination): RecordItem {
    return { ...item, nativeName: item.publications.find(p => p.destination === destination)?.nativeName ?? item.nativeName };
  }
  private folder(item: RecordItem) { return path.join(this.root, 'skills', item.nativeName, item.folderRevision ?? ''); }
  private validate(input: LibraryInput, old?: RecordItem): LibraryInput {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new HttpError(400, 'A display name is required (maximum 200 characters).');
    if (input.definition) {
      const d = input.definition;
      if (!['stdio', 'http'].includes(d.transport) || typeof d.enabled !== 'boolean' || (d.args !== undefined && (!Array.isArray(d.args) || !d.args.every(a => typeof a === 'string'))) || (d.cwd !== undefined && (typeof d.cwd !== 'string' || !path.isAbsolute(d.cwd)))) throw new HttpError(400, 'Invalid MCP definition.');
      if (d.transport === 'stdio' && (typeof d.command !== 'string' || !d.command.trim())) throw new HttpError(400, 'A command is required.');
      if (d.transport === 'http') { try { if (!['http:', 'https:'].includes(new URL(d.url ?? '').protocol) || new URL(d.url!).username || new URL(d.url!).password || /(?:token|key|secret|password|authorization)/i.test(new URL(d.url!).search)) throw Error(); } catch { throw new HttpError(400, 'An HTTP URL is required.'); } }
      for (const field of ['env', 'headers'] as const) {
        if (d[field] !== undefined && !validMap(d[field])) throw new HttpError(400, `Invalid ${field}.`);
        if (d[field] && Object.entries(d[field]).some(([key, value]) => value === credentialMask && old?.definition?.[field]?.[key] === undefined)) throw new HttpError(400, 'A new credential requires a value.');
      }
      if (d.transport === 'stdio' && d.args?.some(arg => /(?:--?(?:token|password|secret|api[-_]key)(?:=|$)|Bearer\s)/i.test(arg))) throw new HttpError(400, 'Put API tokens in environment variables instead of command arguments.');
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
  private validateAgent(input: LibraryInput, old?: RecordItem): LibraryInput {
    let agent = input.agent;
    if (input.definition) throw new HttpError(400, 'Invalid agent definition.');
    if (input.content !== undefined) {
      if (typeof input.content !== 'string') throw new HttpError(400, 'Agent Markdown must be a string.');
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(input.content);
      let front: unknown;
      try { front = match && parseYaml(match[1]!); } catch { throw new HttpError(400, 'Invalid YAML frontmatter.'); }
      if (!front || typeof front !== 'object' || Array.isArray(front)) throw new HttpError(400, 'Agent Markdown requires name and description frontmatter.');
      const fields = front as Record<string, unknown>;
      const unsupported = Object.keys(fields).filter(key => !['name', 'description'].includes(key));
      if (unsupported.length) throw new HttpError(400, `Unsupported agent frontmatter fields: ${unsupported.join(', ')}.`);
      agent = { name: fields.name as string, description: fields.description as string, instructions: input.content.slice(match![0].length).replace(/^\r?\n/, '').replace(/\r?\n$/, '') };
    }
    if (!agent || typeof agent.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent.name) || agent.name.length > 64 || ['constructor', 'prototype', '__proto__'].includes(agent.name)) throw new HttpError(400, 'Use a lowercase hyphenated agent name (maximum 64 characters).');
    if (typeof agent.description !== 'string' || !agent.description.trim() || typeof agent.instructions !== 'string' || !agent.instructions.trim()) throw new HttpError(400, 'Agent description and instructions are required.');
    if (old && agent.name !== old.nativeName) throw new HttpError(400, 'The original agent name is immutable; change the display name instead.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new HttpError(400, 'A display name is required (maximum 200 characters).');
    agent = { name: agent.name, description: agent.description, instructions: agent.instructions };
    return { name: input.name.trim(), agent, content: `---\n${stringifyYaml({ name: agent.name, description: agent.description })}---\n\n${agent.instructions}\n` };
  }
  private agentOutput(item: RecordItem, destination: Destination) {
    const agent = item.agent!;
    if (destination === 'codex') return stringifyToml({ name: agent.name, description: agent.description, developer_instructions: agent.instructions });
    const front = destination === 'antigravity' ? { name: agent.name, description: agent.description, subagent: true, mainAgent: false } : { description: agent.description, mode: 'subagent' };
    return `---\n${stringifyYaml(front)}---\n\n${agent.instructions}\n`;
  }
  private async safeParents(file: string) {
    for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
      const stat = await fs.lstat(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw conflict();
    }
  }
  private async agentConflicts(item: RecordItem, destination: Destination, file: string) {
    await this.safeParents(file);
    const builtins: Partial<Record<Destination, string[]>> = {
      codex: ['default', 'worker', 'explorer'], antigravity: ['research', 'browser', 'self'], opencode: ['build', 'plan', 'general', 'explore', 'compaction', 'title', 'summary'],
    };
    if (builtins[destination]?.includes(item.nativeName)) throw new HttpError(409, 'This name belongs to a built-in provider agent.');
    const base = destination === 'codex' ? this.codexHome : destination === 'antigravity' ? path.join(this.home, '.gemini/config') : path.join(this.configHome, 'opencode');
    for (const folder of ['agents', 'agent']) {
      const dir = path.join(base, folder);
      await this.safeParents(path.join(dir, 'placeholder'));
      for (const entry of await fs.readdir(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; })) {
        const candidate = path.join(dir, entry);
        if (candidate === file) continue;
        if (entry.replace(/\.(md|toml|yaml|yml|json|jsonc)$/i, '') === item.nativeName) throw conflict();
        if (destination === 'antigravity') {
          const stat = await fs.lstat(candidate);
          const markdown = stat.isDirectory() && !stat.isSymbolicLink() ? path.join(candidate, 'agent.md') : candidate;
          if ((stat.isDirectory() || entry.endsWith('.md')) && await exists(markdown)) {
            await this.safeParents(markdown);
            if ((await fs.lstat(markdown)).isSymbolicLink()) throw conflict();
            const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(await fs.readFile(markdown, 'utf8'));
            if (match && (parseYaml(match[1]!) as { name?: string } | null)?.name === item.nativeName) throw conflict();
          }
        }
        if (destination === 'codex' && entry.endsWith('.toml')) {
          const stat = await fs.lstat(candidate);
          if (!stat.isFile() || stat.isSymbolicLink()) throw conflict();
          if (parseToml(await fs.readFile(candidate, 'utf8')).name === item.nativeName) throw conflict();
        }
      }
    }
    const configs = destination === 'codex' ? ['config.toml'] : destination === 'opencode' ? ['opencode.json', 'opencode.jsonc'] : ['settings.json', 'config.json'];
    for (const config of configs) {
      const location = path.join(base, config);
      if (!await exists(location)) continue;
      if ((await fs.lstat(location)).isSymbolicLink()) throw conflict();
      const text = await fs.readFile(location, 'utf8');
      const errors: ParseError[] = [];
      const parsed = config.endsWith('.toml') ? parseToml(text) : parse(text, errors, { allowTrailingComma: true }) as Record<string, unknown>;
      if (errors.length || !parsed || typeof parsed !== 'object') throw conflict();
      for (const key of ['agents', 'agent']) {
        const section = parsed[key];
        if (section && typeof section === 'object' && Object.hasOwn(section, item.nativeName)) throw conflict();
      }
    }
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
  private async revision(item: RecordItem) { return item.agent ? hash(canonical(item.agent)) : item.definition ? hash(JSON.stringify({ definition: item.definition, credentialRevision: item.credentialRevision })) : this.tree(this.folder(item)); }
  private destinations(kind: LibraryKind): Destination[] { return kind === 'skills' ? ['agents', 'antigravity'] : ['codex', 'antigravity', 'opencode']; }
  private async target(kind: LibraryKind, item: RecordItem, destination: Destination): Promise<string> {
    if (kind === 'agents') return path.join(destination === 'codex' ? this.codexHome : destination === 'antigravity' ? path.join(this.home, '.gemini/config') : path.join(this.configHome, 'opencode'), 'agents', `${item.nativeName}.${destination === 'codex' ? 'toml' : 'md'}`);
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
    if (kind === 'agents') {
      await this.agentConflicts(item, destination, file);
      const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
      return !stat ? undefined : stat.isFile() && !stat.isSymbolicLink() ? hash(await fs.readFile(file, 'utf8')) : 'unmanaged';
    }
    if (kind === 'mcps') { const { value } = await this.config(file, destination, item.nativeName); return value === undefined ? undefined : hash(canonical(withoutCredentialValues(value))); }
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
  private async ownsMcp(item: RecordItem, destination: Destination, file: string, fingerprint: string | undefined) {
    const owned = item.publications.find(publication => publication.destination === destination);
    if (!owned || owned.path !== file) return false;
    if (owned.fingerprint === fingerprint) return true;
    // Legacy releases fingerprinted the full native entry, including credentials.
    const { value } = await this.config(file, destination, item.nativeName);
    return owned.fingerprint === hash(JSON.stringify(value));
  }
  private rememberCredentials(item: RecordItem) {
    if (!item.definition) return;
    const values = credentialValues(item.definition);
    const previous = this.pendingCredentials.get(item.id);
    const pending: McpCredentials = {};
    for (const field of ['env', 'headers'] as const) {
      const merged = { ...previous?.[field], ...values[field] };
      pending[field] = Object.fromEntries(Object.keys(item.definition[field] ?? {}).filter(key => merged[key] !== undefined).map(key => [key, merged[key]!]));
    }
    if (Object.values(pending).some(entries => Object.keys(entries).length)) this.pendingCredentials.set(item.id, pending);
    else this.pendingCredentials.delete(item.id);
    item.definition = maskDefinition(item.definition);
  }
  private async scrubLibrary(catalog: Catalog) {
    for (const item of catalog.mcps) {
      if (!item.originalName) {
        const desired = this.safeName(item.name);
        if (await exists(path.join(this.root, 'mcps', desired))) throw new HttpError(409, 'The original MCP name conflicts with an existing library folder.');
        if (catalog.mcps.some(other => other.id !== item.id && (other.originalName ?? other.name) === desired)) throw new HttpError(409, 'Duplicate original MCP name.');
        for (const publication of item.publications) {
          publication.nativeName ??= item.nativeName;
          publication.snapshotPath ??= this.snapshot(item, publication.destination);
        }
        item.originalName = desired;
        item.nativeName = desired;
      }
      this.rememberCredentials(item);
      if ((await fs.lstat(this.mcpFolder(item)).catch(() => null))?.isSymbolicLink()) throw conflict();
      await this.atomic(path.join(this.mcpFolder(item), 'definition.json'), JSON.stringify(item.definition));
    }
    await this.save(catalog);
    for (const item of catalog.mcps) await fs.rm(path.join(this.root, 'mcps', `${item.id}.json`), { force: true });
  }
  private snapshot(item: RecordItem, destination: Destination) { return item.publications.find(p => p.destination === destination)?.snapshotPath ?? (item.originalName === undefined ? path.join(this.root, 'publications', `${item.id}-${destination}.json`) : path.join(this.mcpFolder(item), `${destination}.json`)); }
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
      if (kind === 'mcps') item = this.published(item, destination);
      const file = await this.target(kind, item, destination);
      const fingerprint = await this.fingerprint(kind, item, destination, file);
      const owned = item.publications.find(p => p.destination === destination);
      const status = owned && owned.path !== file ? 'conflict' : fingerprint === undefined ? 'missing' : !owned || owned.path !== file || (kind === 'mcps' ? !await this.ownsMcp(item, destination, file, fingerprint) : owned.fingerprint !== fingerprint) || !await this.snapshotIntact(item, owned) ? 'conflict' : owned.revision !== await this.revision(item) ? 'outdated' : 'installed';
      return { destination, status };
    } catch (error) { return { destination, status: error instanceof HttpError && error.status === 409 ? 'conflict' : 'error', message: error instanceof HttpError ? error.message : 'Cannot read publication or provider configuration.' }; }
  }
  private async hasLegacyCredentials(item: RecordItem): Promise<boolean> {
    const hasValues = (definition: McpDefinition) => Object.values(credentialValues(definition)).some(values => Object.keys(values).length > 0);
    if (item.definition && hasValues(item.definition)) return true;
    for (const publication of item.publications) {
      if (!publication.snapshotFingerprint) continue;
      try {
        const definition = JSON.parse(await fs.readFile(this.snapshot(item, publication.destination), 'utf8')) as McpDefinition;
        if (hasValues(definition)) return true;
      } catch { /* Publication status separately reports unreadable snapshots. */ }
    }
    return false;
  }
  async list(kind: LibraryKind): Promise<LibraryItem[]> {
    await this.queue;
    const catalog = await this.read();
    return Promise.all(catalog[kind].map(async item => ({ id: item.id, nativeName: item.nativeName, name: item.name, ...(kind === 'mcps' ? { credentialMigrationRequired: await this.hasLegacyCredentials(item) } : {}), content: item.content, agent: item.agent, definition: item.definition && { ...item.definition, env: item.definition.env && Object.fromEntries(Object.keys(item.definition.env).map(k => [k, '••••••'])), headers: item.definition.headers && Object.fromEntries(Object.keys(item.definition.headers).map(k => [k, '••••••'])) }, installations: await Promise.all(this.destinations(kind).map(d => this.status(kind, item, d))) })));
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
      const validated = kind === 'agents' ? this.validateAgent(input, old) : this.validate(input, old);
      const skillName = kind === 'skills' ? (parseYaml(/^---\r?\n([\s\S]*?)\r?\n---/.exec(validated.content!)![1]!) as { name: string }).name : undefined;
      if (skillName && old && skillName !== old.nativeName) throw new HttpError(400, 'The skill frontmatter name is immutable; change the display name instead.');
      if (skillName && !old && catalog.skills.some(item => item.nativeName === skillName)) throw new HttpError(409, 'A skill with this native name already exists.');
      if (kind === 'mcps' && old && !old.originalName) await this.scrubLibrary(catalog);
      const originalName = kind === 'mcps' ? this.safeName(old?.originalName ?? old?.name ?? input.nativeName ?? validated.name) : undefined;
      if (originalName && catalog.mcps.some(i => i.id !== old?.id && (i.originalName ?? i.name) === originalName)) throw new HttpError(409, 'An MCP with this original name already exists.');
      if (kind === 'mcps' && !old && await exists(path.join(this.root, 'mcps', originalName!))) throw new HttpError(409, 'An MCP folder with this original name already exists.');
      const item: RecordItem = { ...validated, id: old?.id ?? randomUUID(), nativeName: old?.nativeName ?? validated.agent?.name ?? skillName ?? originalName!, originalName, publications: old?.publications ?? [], ...(kind === 'mcps' ? { credentialRevision: Object.values(credentialValues(validated.definition!)).some(values => Object.keys(values).length) ? randomUUID() : old?.credentialRevision } : {}), ...(kind === 'skills' ? { folderRevision: randomUUID() } : {}) };
      if (kind === 'agents') {
        if (!old && (catalog.agents.some(other => other.nativeName === item.nativeName) || await exists(path.join(this.root, 'agents', item.nativeName)))) throw new HttpError(409, 'An agent with this original name already exists.');
        await this.safeParents(path.join(this.root, 'agents', item.nativeName, 'agent.md'));
        const canonicalFile = path.join(this.root, 'agents', item.nativeName, 'agent.md');
        if ((await fs.lstat(canonicalFile).catch(() => undefined))?.isSymbolicLink()) throw conflict();
        await this.atomic(canonicalFile, item.content!);
      } else if (kind === 'skills') {
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
      } else this.rememberCredentials(item);
      catalog[kind] = [...catalog[kind].filter(i => i.id !== item.id), item];
      if (kind === 'mcps') await this.scrubLibrary(catalog); else await this.save(catalog);
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
    if (destination === 'opencode') return { type: 'local', command: d.cwd ? [process.execPath, path.join(this.root, 'launcher.cjs'), this.snapshot(item, destination)] : [d.command!, ...d.args ?? []], enabled: d.enabled, environment: d.env ?? {} };
    return { command: d.command!, args: d.args ?? [], env: d.env ?? {}, ...(d.cwd ? { cwd: d.cwd } : {}), ...(destination === 'codex' ? { enabled: d.enabled } : { disabled: !d.enabled }) };
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
      const expected = value === undefined ? undefined : canonical(value);
      if (canonical((parsed.mcp_servers as Record<string, unknown> | undefined)?.[item.nativeName]) !== expected) throw conflict();
      const original = parseToml(before.text);
      for (const doc of [original, parsed]) { const servers = doc.mcp_servers as Record<string, unknown> | undefined; if (servers) { delete servers[item.nativeName]; if (!Object.keys(servers).length) delete doc.mcp_servers; } }
      if (canonical(original) !== canonical(parsed)) throw conflict();
    } else next = applyEdits(before.text || '{}', modify(before.text || '{}', [destination === 'opencode' ? 'mcp' : 'mcpServers', item.nativeName], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    if ((await this.config(file, destination, item.nativeName)).text !== before.text) throw conflict();
    await this.atomic(file, next);
  }
  private async publish(kind: LibraryKind, item: RecordItem, destination: Destination, uninstall: boolean, definition?: McpDefinition) {
    const record = item;
    if (kind === 'mcps') {
      const previous = this.published(item, destination);
      const desired = item.originalName ?? this.safeName(item.name);
      if (previous.nativeName !== desired && !uninstall) {
        const file = await this.target(kind, item, destination);
        const next: RecordItem = { ...item, nativeName: desired, publications: [] };
        if ((await this.config(file, destination, desired)).value !== undefined) throw new HttpError(409, 'The original MCP name conflicts with an existing provider entry.');
        const publication = previous.publications.find(p => p.destination === destination);
        if (publication && publication.path !== file) throw conflict();
        const fingerprint = await this.fingerprint(kind, previous, destination, file);
        if ((fingerprint !== undefined && !await this.ownsMcp(previous, destination, file, fingerprint)) || !await this.snapshotIntact(previous, previous.publications.find(p => p.destination === destination))) throw conflict();
        const before = (await this.config(file, destination, previous.nativeName)).text;
        const existing = providerEntry((await this.config(file, destination, previous.nativeName)).value) ?? {};
        try {
          await this.publish(kind, next, destination, false, definition);
          // Preserve provider-only metadata on the renamed entry.
          const renamed = providerEntry((await this.config(file, destination, desired)).value)!;
          const metadata = { ...existing };
          for (const key of ['type', 'url', 'serverUrl', 'command', 'args', 'env', 'environment', 'cwd', 'headers', 'http_headers']) delete metadata[key];
          await this.writeConfig(file, destination, next, { ...metadata, ...renamed });
          if (fingerprint !== undefined) await this.writeConfig(file, destination, previous, undefined);
          next.publications[0]!.fingerprint = (await this.fingerprint(kind, next, destination, file))!;
        } catch (error) { await this.atomic(file, before); throw error; }
        const oldSnapshot = this.snapshot(previous, destination);
        if (oldSnapshot !== this.snapshot(next, destination)) await fs.rm(oldSnapshot, { force: true });
        item.publications = [...item.publications.filter(p => p.destination !== destination), { ...next.publications[0]!, nativeName: desired }];
        return;
      }
      item = this.published(item, destination);
    }
    const file = await this.target(kind, item, destination);
    const current = await this.fingerprint(kind, item, destination, file);
    const owned = item.publications.find(p => p.destination === destination);
    if (owned && owned.path !== file) throw conflict();
    if (!await this.snapshotIntact(item, owned)) throw conflict();
    if (current !== undefined && (!owned || owned.path !== file || (kind === 'mcps' ? !await this.ownsMcp(item, destination, file, current) : owned.fingerprint !== current))) throw conflict();
    const previousSnapshot = kind === 'mcps' ? this.snapshot(item, destination) : undefined;
    if (kind === 'mcps' && !uninstall && owned?.snapshotPath) {
      item = { ...item, publications: item.publications.map(p => p === owned ? { ...p, snapshotPath: undefined } : p) };
    }
    if (kind === 'mcps') {
      if (uninstall) { if (current !== undefined) await this.writeConfig(file, destination, item, undefined); }
      else {
        const existing = providerEntry((await this.config(file, destination, item.nativeName)).value) ?? {};
        // Preserve provider-only options, including OAuth configuration; never read OAuth tokens.
        const native = this.native({ ...item, definition: definition ?? item.definition }, destination);
        const value = { ...existing, ...native };
        for (const key of ['type', 'url', 'serverUrl', 'command', 'args', 'env', 'environment', 'cwd', 'headers', 'http_headers']) {
          if (!(key in native)) delete value[key];
        }
        const oldSnapshot = await fs.readFile(this.snapshot(item, destination), 'utf8').catch(() => undefined);
        const needsLauncher = destination === 'opencode' && item.definition?.transport === 'stdio' && !!item.definition.cwd;
        if (needsLauncher) {
          const launcher = path.join(this.root, 'launcher.cjs');
          const existingLauncher = await fs.readFile(launcher, 'utf8').catch(() => undefined);
          if (existingLauncher !== undefined && existingLauncher !== launcherSource) throw conflict();
          await this.atomic(launcher, launcherSource);
          const nonSecret = { ...item.definition! };
          delete nonSecret.env; delete nonSecret.headers;
          await this.atomic(this.snapshot(item, destination), JSON.stringify(nonSecret));
        }
        try { await this.writeConfig(file, destination, item, value); }
        catch (error) {
          if (needsLauncher) { if (oldSnapshot === undefined) await fs.rm(this.snapshot(item, destination), { force: true }); else await this.atomic(this.snapshot(item, destination), oldSnapshot); }
          throw error;
        }
      }
    } else if (kind === 'agents') {
      if (await this.fingerprint(kind, item, destination, file) !== current) throw conflict();
      if (uninstall) { if (current !== undefined) await fs.rm(file); }
      else await this.atomic(file, this.agentOutput(item, destination));
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
    if (kind === 'mcps' && previousSnapshot && (uninstall || previousSnapshot !== this.snapshot(item, destination))) await fs.rm(previousSnapshot, { force: true });
    item.publications = item.publications.filter(p => p.destination !== destination);
    const usesLauncher = !uninstall && kind === 'mcps' && destination === 'opencode' && item.definition?.transport === 'stdio' && !!item.definition.cwd;
    if (kind === 'mcps' && owned?.snapshotFingerprint && !usesLauncher) await fs.rm(this.snapshot(item, destination), { force: true });
    record.publications = item.publications;
    if (!uninstall) item.publications.push({ destination, nativeName: item.nativeName, path: file, fingerprint: (await this.fingerprint(kind, item, destination, file))!, revision: await this.revision(item), ...(usesLauncher ? { snapshotFingerprint: hash(await fs.readFile(this.snapshot(item, destination), 'utf8')) } : {}) });
  }
  private async resolveCredentials(item: RecordItem, options: Partial<SyncRequest>): Promise<McpDefinition> {
    if (options.credentialSource !== undefined && !this.destinations('mcps').includes(options.credentialSource)) throw new HttpError(400, 'Select a valid credential source.');
    for (const field of ['env', 'headers'] as const) {
      if (options.credentials?.[field] !== undefined && !validMap(options.credentials[field])) throw new HttpError(400, 'Credentials must be string values.');
    }
    const definition = item.definition!;
    const supplied = this.pendingCredentials.get(item.id);
    const explicit = credentialValues({ ...definition, ...options.credentials });
    const sources: { destination: Destination; credentials: McpCredentials }[] = [];
    for (const owned of item.publications) {
      if (options.credentialSource && owned.destination !== options.credentialSource) continue;
      try {
        const published = this.published(item, owned.destination);
        const file = await this.target('mcps', published, owned.destination);
        const fingerprint = await this.fingerprint('mcps', published, owned.destination, file);
        if (fingerprint === undefined || !await this.ownsMcp(published, owned.destination, file, fingerprint)) continue;
        const entry = (await this.config(file, owned.destination, published.nativeName)).value;
        let credentials = providerCredentials(entry, definition.transport);
        if (owned.snapshotFingerprint && await this.snapshotIntact(item, owned)) {
          const snapshot = JSON.parse(await fs.readFile(this.snapshot(item, owned.destination), 'utf8')) as McpDefinition;
          credentials = { ...credentialValues(snapshot), ...credentials };
        }
        sources.push({ destination: owned.destination, credentials });
      } catch { /* An unreadable or conflicting entry cannot supply credentials. */ }
    }
    if (options.credentialSource && !sources.some(source => source.destination === options.credentialSource)) throw new HttpError(409, 'The selected credential source is unavailable or externally modified.');
    const resolved: McpCredentials = {};
    for (const field of ['env', 'headers'] as const) {
      const values: Record<string, string> = {};
      for (const key of Object.keys(definition[field] ?? {})) {
        const incoming = explicit[field]?.[key] ?? supplied?.[field]?.[key];
        if (incoming !== undefined && incoming !== credentialMask) { Object.defineProperty(values, key, { value: incoming, enumerable: true }); continue; }
        const candidates = new Set(sources.flatMap(source => source.credentials[field]?.[key] === undefined ? [] : [source.credentials[field]![key]!]));
        if (candidates.size > 1) throw new HttpError(409, 'Providers have different credentials. Select a credential source or enter replacement values.');
        const value = [...candidates][0];
        if (value === undefined) throw new HttpError(409, 'Credentials are unavailable. Enter values again, then sync.');
        Object.defineProperty(values, key, { value, enumerable: true });
      }
      resolved[field] = values;
    }
    return { ...definition, ...resolved };
  }
  sync(kind: LibraryKind, id: string, destinations: Destination[], uninstall = false, options: Partial<SyncRequest> = {}) {
    return this.serialized(async () => {
      if (!Array.isArray(destinations) || !destinations.length || !destinations.every(d => this.destinations(kind).includes(d))) throw new HttpError(400, 'Select valid destinations.');
      const catalog = await this.read();
      const item = catalog[kind].find(i => i.id === id);
      if (!item) throw new HttpError(404, 'Library item not found.');
      let definition: McpDefinition | undefined;
      if (kind === 'mcps' && !uninstall) definition = await this.resolveCredentials(item, options);
      if (kind === 'mcps') await this.scrubLibrary(catalog);
      const results: PublicationStatus[] = [];
      for (const destination of new Set(destinations)) {
        try { await this.publish(kind, item, destination, uninstall, definition); await this.save(catalog); results.push(await this.status(kind, item, destination)); }
        catch (error) { results.push({ destination, status: error instanceof HttpError && error.status === 409 ? 'conflict' : 'error', message: error instanceof HttpError ? error.message : 'Publication could not be changed safely.' }); }
      }
      if (kind === 'mcps' && results.some(result => result.status === 'installed')) this.pendingCredentials.delete(id);
      return results;
    });
  }
  remove(kind: LibraryKind, id: string) {
    return this.serialized(async () => {
      const catalog = await this.read();
      const item = catalog[kind].find(i => i.id === id);
      if (!item) throw new HttpError(404, 'Library item not found.');
      for (const publication of [...item.publications]) { await this.publish(kind, item, publication.destination, true); await this.save(catalog); }
      if (kind === 'agents') {
        await this.safeParents(path.join(this.root, 'agents', item.nativeName, 'agent.md'));
        await fs.rm(path.join(this.root, 'agents', item.nativeName), { recursive: true, force: true });
      }
      else if (kind === 'skills') await fs.rm(path.join(this.root, 'skills', item.nativeName), { recursive: true, force: true });
      else { if (item.originalName) await fs.rm(this.mcpFolder(item), { recursive: true, force: true }); await fs.rm(path.join(this.root, 'mcps', `${id}.json`), { force: true }); }
      this.pendingCredentials.delete(id);
      catalog[kind] = catalog[kind].filter(i => i.id !== id);
      if (kind === 'mcps') await this.scrubLibrary(catalog); else await this.save(catalog);
    });
  }
}
