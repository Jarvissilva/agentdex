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
  const native = parse(await fs.readFile(config, 'utf8')).mcp[item.nativeName] as { command: string[]; enabled: boolean };
  assert.equal(native.command.includes('private-value'), false);
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(native.command[0]!, native.command.slice(1));
    let text = ''; child.stdout.on('data', chunk => { text += String(chunk); }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(text) : reject(Error(`exit ${code}`)));
  });
  assert.equal(output, `private-value:${home}`);
  await service.put('mcps', { name: 'Renamed', definition: { ...item.definition!, enabled: false } }, id);
  assert.equal((await service.list('mcps'))[0]!.installations[0]!.status, 'outdated');
  assert.equal(JSON.parse(await fs.readFile(native.command[2]!, 'utf8')).enabled, true);
  assert.deepEqual((await service.sync('mcps', id, ['codex', 'antigravity', 'opencode'])).map(s => s.status), ['installed', 'installed', 'installed']);
  assert.equal(JSON.parse(await fs.readFile(native.command[2]!, 'utf8')).env.TEST_SECRET, 'private-value');
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
  const mcp = await service.put('mcps', { name: 'MCP', definition: stdio() });
  await service.sync('mcps', mcp, ['opencode']);
  await fs.writeFile(path.join(options.root, 'publications', `${mcp}-opencode.json`), '{}');
  assert.equal((await service.sync('mcps', mcp, ['opencode']))[0]!.status, 'conflict');
});
