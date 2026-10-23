import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { parse } from 'jsonc-parser';
import { parse as toml } from '@iarna/toml';
import LibraryService from '../src/services/LibraryService.js';
import type { McpDefinition } from '@agentdex/shared';

const content = '---\nname: test-skill\ndescription: A useful test skill\n---\n\nInstructions\n';
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdex-library-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const options = { home, root: path.join(home, '.local/share/agentdex'), configHome: path.join(home, '.config'), codexHome: path.join(home, '.codex') };
  return { home, options, service: new LibraryService(options) };
}
const stdio = (): McpDefinition => ({ transport: 'stdio', enabled: true, command: process.execPath, args: ['-e', 'process.stdout.write(process.env.TEST_SECRET + ":" + process.cwd())'], env: { TEST_SECRET: 'private-value' } });

test('skill creation, import, full-folder publication, update, restart and uninstall', async t => {
  const { home, options, service } = await setup(t);
  assert.deepEqual(await service.list('skills'), []);
  await assert.rejects(fs.stat(options.root), { code: 'ENOENT' });
  const source = path.join(home, 'source');
  await fs.mkdir(path.join(source, 'references'), { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), content);
  await fs.writeFile(path.join(source, 'references', 'guide.txt'), 'support');
  const id = await service.put('skills', { name: 'My skill' }, undefined, source);
  assert.deepEqual((await service.sync('skills', id, ['agents', 'antigravity'])).map(s => s.status), ['installed', 'installed']);
  const link = path.join(home, '.agents/skills/test-skill');
  const copy = path.join(home, '.gemini/antigravity-cli/skills/test-skill');
  assert.ok((await fs.readlink(link)).startsWith(path.join(options.root, 'skills/test-skill/')));
  assert.equal(await fs.readFile(path.join(copy, 'references/guide.txt'), 'utf8'), 'support');
  await service.put('skills', { name: 'Renamed', content: content + 'Updated\n' }, id);
  assert.deepEqual((await service.list('skills'))[0]!.installations.map(s => s.status), ['outdated', 'outdated']);
  assert.equal(await fs.readFile(path.join(copy, 'SKILL.md'), 'utf8'), content);
  assert.equal(await fs.readFile(path.join(link, 'SKILL.md'), 'utf8'), content);
  assert.equal(await fs.readFile(path.join(link, 'references/guide.txt'), 'utf8'), 'support');
  assert.equal((await new LibraryService(options).list('skills'))[0]!.name, 'Renamed');
  assert.deepEqual((await service.sync('skills', id, ['agents', 'antigravity'])).map(s => s.status), ['installed', 'installed']);
  await service.remove('skills', id);
  assert.deepEqual(await service.list('skills'), []);
  await assert.rejects(fs.lstat(link), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(copy), { code: 'ENOENT' });
});

test('validation rejects bad frontmatter, duplicate or changed native names and symlink imports', async t => {
  const { home, service } = await setup(t);
  await assert.rejects(service.put('skills', { name: 'Bad', content: 'No frontmatter' }));
  const id = await service.put('skills', { name: 'Good', content });
  await assert.rejects(service.put('skills', { name: 'Duplicate', content }));
  await assert.rejects(service.put('skills', { name: 'Changed', content: content.replace('test-skill', 'changed') }, id));
  const source = path.join(home, 'import');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'SKILL.md'), content);
  await fs.symlink('/etc/passwd', path.join(source, 'secret'));
  await assert.rejects(service.put('skills', { name: 'Unsafe' }, undefined, source));
});

test('unmanaged skills, external changes and cleanup failures preserve the library', async t => {
  const { home, service } = await setup(t);
  const id = await service.put('skills', { name: 'Skill', content });
  const copy = path.join(home, '.gemini/antigravity-cli/skills/test-skill');
  await fs.mkdir(copy, { recursive: true });
  await fs.writeFile(path.join(copy, 'SKILL.md'), 'unmanaged');
  const results = await service.sync('skills', id, ['agents', 'antigravity']);
  assert.deepEqual(results.map(s => s.status), ['installed', 'conflict']);
  await fs.rm(copy, { recursive: true });
  await service.sync('skills', id, ['antigravity']);
  await fs.writeFile(path.join(copy, 'SKILL.md'), 'external edit');
  assert.equal((await service.sync('skills', id, ['antigravity']))[0]!.status, 'conflict');
  assert.equal((await service.sync('skills', id, ['antigravity'], true))[0]!.status, 'conflict');
  await assert.rejects(service.remove('skills', id));
  assert.equal((await service.list('skills')).length, 1);
  assert.equal(await fs.readFile(path.join(copy, 'SKILL.md'), 'utf8'), 'external edit');
});

test('MCP native translation, comments, launcher, private secrets, manual updates and repeat sync', async t => {
  const { home, options, service } = await setup(t);
  const config = path.join(home, '.config/opencode/opencode.jsonc');
  await fs.mkdir(path.dirname(config), { recursive: true });
  await fs.writeFile(config, '{\n // preserve me\n "theme": "dark",\n "mcp": {}\n}\n');
  await fs.mkdir(options.codexHome, { recursive: true });
  await fs.writeFile(path.join(options.codexHome, 'config.toml'), '# user comment\nmodel = "existing"\n\n[mcp_servers.other]\ncommand = "other"\n');
  const definition = { ...stdio(), cwd: home };
  const id = await service.put('mcps', { name: 'Test', definition });
  assert.deepEqual((await service.sync('mcps', id, ['codex', 'antigravity', 'opencode'])).map(s => s.status), ['installed', 'installed', 'installed']);
  const item = (await service.list('mcps'))[0]!;
  assert.equal(item.definition!.env!.TEST_SECRET, '••••••');
  assert.equal((await fs.stat(path.join(options.root, 'catalog.json'))).mode & 0o777, 0o600);
  const native = parse(await fs.readFile(config, 'utf8')).mcp[item.nativeName] as { command: string[]; enabled: boolean; environment: Record<string, string> };
  assert.equal(native.command.includes('private-value'), false);
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(native.command[0]!, native.command.slice(1), { env: { ...process.env, ...native.environment } });
    let text = ''; child.stdout.on('data', chunk => { text += String(chunk); }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(text) : reject(Error(`exit ${code}`)));
  });
  assert.equal(output, `private-value:${home}`);
  await service.put('mcps', { name: 'Renamed', definition: { ...item.definition!, enabled: false } }, id);
  assert.equal((await service.list('mcps'))[0]!.installations[0]!.status, 'outdated');
  assert.equal(JSON.parse(await fs.readFile(native.command[2]!, 'utf8')).enabled, true);
  assert.deepEqual((await service.sync('mcps', id, ['codex', 'antigravity', 'opencode'])).map(s => s.status), ['installed', 'installed', 'installed']);
  assert.equal(JSON.parse(await fs.readFile(native.command[2]!, 'utf8')).env, undefined);
  assert.equal(parse(await fs.readFile(config, 'utf8')).mcp[item.nativeName].environment.TEST_SECRET, 'private-value');
  assert.equal(JSON.parse(await fs.readFile(native.command[2]!, 'utf8')).enabled, false);
  assert.deepEqual((await service.sync('mcps', id, ['codex', 'opencode'])).map(s => s.status), ['installed', 'installed']);
  const codex = await fs.readFile(path.join(options.codexHome, 'config.toml'), 'utf8');
  assert.ok(codex.includes('# user comment'));
  assert.equal((toml(codex).mcp_servers as Record<string, { enabled: boolean }>)[item.nativeName]!.enabled, false);
  assert.ok((await fs.readFile(config, 'utf8')).includes('// preserve me'));
  await service.remove('mcps', id);
  assert.ok((await fs.readFile(config, 'utf8')).includes('// preserve me'));
  assert.equal(parse(await fs.readFile(config, 'utf8')).theme, 'dark');
  assert.equal((toml(await fs.readFile(path.join(options.codexHome, 'config.toml'), 'utf8')).mcp_servers as Record<string, unknown>).other !== undefined, true);
});

test('HTTP MCPs and conflict detection for malformed, externally edited and ambiguous configuration', async t => {
  const { home, service } = await setup(t);
  const id = await service.put('mcps', { name: 'HTTP', definition: { transport: 'http', enabled: true, url: 'https://example.com/mcp', headers: { Authorization: 'secret' } } });
  assert.deepEqual((await service.sync('mcps', id, ['codex', 'antigravity', 'opencode'])).map(s => s.status), ['installed', 'installed', 'installed']);
  const item = (await service.list('mcps'))[0]!;
  assert.equal(item.definition!.headers!.Authorization, '••••••');
  const config = path.join(home, '.config/opencode/opencode.json');
  const json = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.equal(json.mcp[item.nativeName].type, 'remote');
  json.mcp[item.nativeName].url = 'https://external.example';
  await fs.writeFile(config, JSON.stringify(json));
  assert.equal((await service.sync('mcps', id, ['opencode']))[0]!.status, 'conflict');
  await fs.writeFile(`${config}c`, '{}');
  assert.equal((await service.sync('mcps', id, ['opencode']))[0]!.status, 'conflict');
  await fs.writeFile(path.join(home, '.codex/config.toml'), 'broken = [');
  assert.equal((await service.sync('mcps', id, ['codex']))[0]!.status, 'conflict');
  await assert.rejects(service.remove('mcps', id));
  assert.equal((await service.list('mcps')).length, 1);
});

test('externally modified linked skill content and private MCP snapshots are conflicts', async t => {
  const { options, service } = await setup(t);
  const skill = await service.put('skills', { name: 'Skill', content });
  await service.sync('skills', skill, ['agents']);
  const link = path.join(options.home, '.agents/skills/test-skill');
  await fs.writeFile(path.join(link, 'SKILL.md'), content + 'External change');
  assert.equal((await service.list('skills'))[0]!.installations[0]!.status, 'conflict');
  assert.equal((await service.sync('skills', skill, ['agents']))[0]!.status, 'conflict');
  const mcp = await service.put('mcps', { name: 'MCP', definition: { ...stdio(), cwd: options.home } });
  await service.sync('mcps', mcp, ['opencode']);
  await fs.writeFile(path.join(options.root, 'mcps', 'MCP', 'opencode.json'), '{}');
  assert.equal((await service.sync('mcps', mcp, ['opencode']))[0]!.status, 'conflict');
});

async function storedFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    files.push(...entry.isDirectory() ? await storedFiles(file) : [await fs.readFile(file, 'utf8')]);
  }
  return files;
}

test('credentials stay out of Agentdex files and sync from provider-owned config after restart', async t => {
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'Private HTTP', definition: { transport: 'http', enabled: true, url: 'https://example.com/mcp', headers: { Authorization: 'provider-only-secret' } } });
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('provider-only-secret')));
  await service.sync('mcps', id, ['codex']);
  const restarted = new LibraryService(options);
  assert.equal((await restarted.sync('mcps', id, ['antigravity', 'opencode']))[0]!.status, 'installed');
  const item = (await restarted.list('mcps'))[0]!;
  const config = path.join(home, '.config/opencode/opencode.json');
  assert.equal(JSON.parse(await fs.readFile(config, 'utf8')).mcp[item.nativeName].headers.Authorization, 'provider-only-secret');
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('provider-only-secret')));
  assert.equal((await fs.stat(config)).mode & 0o777, 0o600);
});

test('conflicting rotated provider tokens require a source and never overwrite configuration on conflict', async t => {
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'MCP', definition: stdio() });
  await service.sync('mcps', id, ['codex', 'opencode']);
  const item = (await service.list('mcps'))[0]!;
  const file = path.join(home, '.config/opencode/opencode.json');
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  doc.mcp[item.nativeName].environment.TEST_SECRET = 'rotated-secret';
  await fs.writeFile(file, JSON.stringify(doc));
  const restarted = new LibraryService(options);
  assert.equal((await restarted.list('mcps'))[0]!.installations.find(i => i.destination === 'opencode')!.status, 'installed');
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(restarted.sync('mcps', id, ['opencode']), /different credentials/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.deepEqual((await restarted.sync('mcps', id, ['codex', 'antigravity'], false, { credentialSource: 'opencode' })).map(result => result.status), ['installed', 'installed']);
  const codex = toml(await fs.readFile(path.join(options.codexHome, 'config.toml'), 'utf8'));
  assert.equal(((codex.mcp_servers as Record<string, Record<string, unknown>>)[item.nativeName]!.env as Record<string, string>).TEST_SECRET, 'rotated-secret');
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('rotated-secret') && !text.includes('private-value')));
  // A structural edit makes a source ineligible, even if explicitly selected.
  doc.mcp[item.nativeName].command = ['different-server'];
  await fs.writeFile(file, JSON.stringify(doc));
  await assert.rejects(restarted.sync('mcps', id, ['antigravity'], false, { credentialSource: 'opencode' }), /unavailable or externally modified/);
});

test('unsynced tokens disappear on restart and replacement values only apply on sync', async t => {
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'MCP', definition: stdio() });
  const restarted = new LibraryService(options);
  await assert.rejects(restarted.sync('mcps', id, ['codex']), /unavailable/);
  await restarted.sync('mcps', id, ['codex'], false, { credentials: { env: { TEST_SECRET: 'new-value' } } });
  const item = (await restarted.list('mcps'))[0]!;
  const config = path.join(home, '.codex/config.toml');
  const before = await fs.readFile(config, 'utf8');
  await restarted.put('mcps', { name: item.name, definition: { ...item.definition!, env: { TEST_SECRET: 'next-value' } } }, id);
  assert.equal((await restarted.list('mcps'))[0]!.installations[0]!.status, 'outdated');
  assert.equal(await fs.readFile(config, 'utf8'), before);
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('next-value')));
  await restarted.sync('mcps', id, ['codex']);
  assert.ok((await fs.readFile(config, 'utf8')).includes('next-value'));
});

test('partial failures allow credential recovery from successful providers', async t => {
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'MCP', definition: stdio() });
  const file = path.join(home, '.config/opencode/opencode.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{invalid');
  assert.deepEqual((await service.sync('mcps', id, ['codex', 'opencode'])).map(result => result.status), ['installed', 'conflict']);
  await fs.writeFile(file, '{}');
  assert.equal((await new LibraryService(options).sync('mcps', id, ['opencode']))[0]!.status, 'installed');
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('private-value')));
});

test('legacy launcher credentials migrate on explicit sync without breaking other destinations', async t => {
  const { createHash } = await import('node:crypto');
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const { home, options, service } = await setup(t);
  const definition = { ...stdio(), cwd: home };
  const id = await service.put('mcps', { name: 'Legacy', definition });
  await service.sync('mcps', id, ['opencode']);
  const catalogFile = path.join(options.root, 'catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const item = catalog.mcps[0];
  const snapshot = path.join(options.root, 'mcps', 'Legacy', 'opencode.json');
  const oldSnapshot = JSON.stringify(definition);
  await fs.writeFile(snapshot, oldSnapshot);
  const configFile = path.join(home, '.config/opencode/opencode.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  delete config.mcp[item.nativeName].environment;
  await fs.writeFile(configFile, JSON.stringify(config));
  item.definition = definition;
  item.publications[0].fingerprint = digest(JSON.stringify(config.mcp[item.nativeName]));
  item.publications[0].snapshotFingerprint = digest(oldSnapshot);
  await fs.writeFile(catalogFile, JSON.stringify(catalog));
  await fs.writeFile(path.join(options.root, 'mcps', `${id}.json`), JSON.stringify(definition));
  const migrated = new LibraryService(options);
  assert.equal((await migrated.list('mcps'))[0]!.credentialMigrationRequired, true);
  assert.equal(await fs.readFile(snapshot, 'utf8'), oldSnapshot); // GET does not migrate.
  assert.deepEqual((await migrated.sync('mcps', id, ['opencode', 'codex'])).map(result => result.status), ['installed', 'installed']);
  assert.equal((await migrated.list('mcps'))[0]!.credentialMigrationRequired, false);
  assert.equal(JSON.parse(await fs.readFile(configFile, 'utf8')).mcp[item.nativeName].environment.TEST_SECRET, 'private-value');
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('private-value')));
  await migrated.remove('mcps', id);
});

test('OAuth stores are untouched and provider interpolation is not copied as a static token', async t => {
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'HTTP', definition: { transport: 'http', enabled: true, url: 'https://example.com/mcp', headers: { Authorization: 'api-token' } } });
  await service.sync('mcps', id, ['opencode']);
  const item = (await service.list('mcps'))[0]!;
  const file = path.join(home, '.config/opencode/opencode.json');
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  doc.mcp[item.nativeName].headers.Authorization = 'Bearer {env:EXTERNAL_TOKEN}';
  await fs.writeFile(file, JSON.stringify(doc));
  const authFile = path.join(home, '.local/share/opencode/mcp-auth.json');
  await fs.mkdir(path.dirname(authFile), { recursive: true });
  const oauth = '{"oauth":"do-not-read-or-copy"}';
  await fs.writeFile(authFile, oauth);
  const restarted = new LibraryService(options);
  await assert.rejects(restarted.sync('mcps', id, ['codex']), /unavailable/);
  assert.equal(await fs.readFile(authFile, 'utf8'), oauth);
  assert.ok((await storedFiles(options.root)).every(text => !text.includes('do-not-read-or-copy')));
});

test('original MCP names are stable, validated and independent of display labels', async t => {
  const { options, service } = await setup(t);
  const definition: McpDefinition = { transport: 'stdio', enabled: true, command: 'example' };
  const id = await service.put('mcps', { name: 'Display label', nativeName: 'original.server', definition });
  assert.equal((await service.list('mcps'))[0]!.nativeName, 'original.server');
  assert.ok(await fs.stat(path.join(options.root, 'mcps/original.server/definition.json')));
  await service.put('mcps', { name: 'New label', definition }, id);
  assert.equal((await service.list('mcps'))[0]!.nativeName, 'original.server');
  await assert.rejects(service.put('mcps', { name: 'Duplicate', nativeName: 'original.server', definition }), /already exists/);
  for (const nativeName of ['../escape', '/absolute', 'a/b', 'a\\b', '.', '__proto__', 'trailing.']) {
    await assert.rejects(service.put('mcps', { name: 'Unsafe', nativeName, definition }), /Unsafe/);
  }
  assert.equal((await service.sync('mcps', id, ['codex']))[0]!.status, 'installed');
  const config = toml(await fs.readFile(path.join(options.codexHome, 'config.toml'), 'utf8'));
  assert.ok((config.mcp_servers as Record<string, unknown>)['original.server']);
  await service.remove('mcps', id);
  await assert.rejects(fs.stat(path.join(options.root, 'mcps/original.server')), { code: 'ENOENT' });
});

for (const collision of [false, true]) test(`legacy provider names migrate safely; collision=${collision}`, async t => {
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'original', definition: stdio() });
  await service.sync('mcps', id, ['opencode']);
  const file = path.join(home, '.config/opencode/opencode.json');
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  doc.mcp['agentdex-legacy'] = doc.mcp.original;
  delete doc.mcp.original;
  if (collision) doc.mcp.original = { type: 'local', command: ['unmanaged'] };
  await fs.writeFile(file, JSON.stringify(doc));
  const catalogFile = path.join(options.root, 'catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  delete catalog.mcps[0].originalName;
  catalog.mcps[0].nativeName = 'agentdex-legacy';
  delete catalog.mcps[0].publications[0].nativeName;
  await fs.writeFile(catalogFile, JSON.stringify(catalog));
  await fs.rename(path.join(options.root, 'mcps/original/definition.json'), path.join(options.root, 'mcps', `${id}.json`));
  await fs.rm(path.join(options.root, 'mcps/original'), { recursive: true });
  const restarted = new LibraryService(options);
  const result = await restarted.sync('mcps', id, ['opencode']);
  assert.equal(result[0]!.status, collision ? 'conflict' : 'installed');
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  if (collision) assert.deepEqual(after, doc);
  else {
    assert.equal(after.mcp['agentdex-legacy'], undefined);
    assert.equal(after.mcp.original.environment.TEST_SECRET, 'private-value');
    await restarted.remove('mcps', id);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).mcp.original, undefined);
  }
});


test('saving a legacy launcher preserves provider credentials until explicit sync', async t => {
  const { createHash } = await import('node:crypto');
  const { home, options, service } = await setup(t);
  const id = await service.put('mcps', { name: 'launcher', definition: { ...stdio(), cwd: home } });
  await service.sync('mcps', id, ['opencode']);
  const catalogFile = path.join(options.root, 'catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const record = catalog.mcps[0];
  const snapshot = path.join(options.root, 'publications', `${id}-opencode.json`);
  await fs.mkdir(path.dirname(snapshot), { recursive: true });
  await fs.rename(path.join(options.root, 'mcps/launcher/opencode.json'), snapshot);
  await fs.rename(path.join(options.root, 'mcps/launcher/definition.json'), path.join(options.root, 'mcps', `${id}.json`));
  await fs.rm(path.join(options.root, 'mcps/launcher'), { recursive: true });
  const file = path.join(home, '.config/opencode/opencode.json');
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  doc.mcp['agentdex-old'] = doc.mcp.launcher;
  delete doc.mcp.launcher;
  doc.mcp['agentdex-old'].command[2] = snapshot;
  await fs.writeFile(file, JSON.stringify(doc));
  record.nativeName = 'agentdex-old';
  delete record.originalName;
  delete record.publications[0].nativeName;
  record.publications[0].fingerprint = createHash('sha256').update(JSON.stringify(doc.mcp['agentdex-old'])).digest('hex');
  await fs.writeFile(catalogFile, JSON.stringify(catalog));
  const restarted = new LibraryService(options);
  await restarted.put('mcps', { name: 'New display', definition: record.definition }, id);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), doc);
  assert.ok(await fs.stat(path.join(options.root, 'mcps/launcher/definition.json')));
  assert.equal((await restarted.sync('mcps', id, ['opencode']))[0]!.status, 'installed');
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(after.mcp['agentdex-old'], undefined);
  assert.equal(after.mcp.launcher.environment.TEST_SECRET, 'private-value');
  assert.equal(after.mcp.launcher.command[2], path.join(options.root, 'mcps/launcher/opencode.json'));
  await assert.rejects(fs.stat(snapshot), { code: 'ENOENT' });
  await restarted.remove('mcps', id);
});
