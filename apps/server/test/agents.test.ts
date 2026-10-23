import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as toml } from '@iarna/toml';
import { parse as yaml } from 'yaml';
import LibraryService from '../src/services/LibraryService.js';
import type { Destination } from '@agentdex/shared';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdex-agents-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const options = { home, root: path.join(home, 'data'), codexHome: path.join(home, 'custom-codex'), configHome: path.join(home, 'custom-config') };
  return { options, service: new LibraryService(options) };
}
const agent = { name: 'test-specialist', description: 'Review: "quoted"\nmultiline \\ text', instructions: 'Check """quotes"""\n\\paths\n你好' };
const destinations: Destination[] = ['codex', 'antigravity', 'opencode'];

test('agents persist, serialize native formats, preserve identity, and require explicit sync', async t => {
  const { options, service } = await setup(t);
  await fs.mkdir(options.root);
  await fs.writeFile(path.join(options.root, 'catalog.json'), JSON.stringify({ skills: [], mcps: [] }));
  assert.deepEqual(await service.list('agents'), []);
  const id = await service.put('agents', { name: 'Specialist', agent });
  const canonical = await fs.readFile(path.join(options.root, 'agents', agent.name, 'agent.md'), 'utf8');
  assert.equal(yaml(canonical.split('---')[1]!).description, agent.description);
  assert.deepEqual((await service.sync('agents', id, destinations)).map(r => r.status), ['installed', 'installed', 'installed']);
  const codex = path.join(options.codexHome, 'agents', `${agent.name}.toml`);
  assert.deepEqual(toml(await fs.readFile(codex, 'utf8')), { name: agent.name, description: agent.description, developer_instructions: agent.instructions });
  for (const [file, expected] of [
    [path.join(options.home, '.gemini/config/agents', `${agent.name}.md`), { name: agent.name, description: agent.description, subagent: true, mainAgent: false }],
    [path.join(options.configHome, 'opencode/agents', `${agent.name}.md`), { description: agent.description, mode: 'subagent' }],
  ] as const) {
    assert.equal((await fs.lstat(file)).isFile(), true);
    assert.deepEqual(yaml((await fs.readFile(file, 'utf8')).split('---')[1]!), expected);
  }
  await service.put('agents', { name: 'New label', content: canonical }, id);
  assert.deepEqual((await new LibraryService(options).list('agents'))[0]!.installations.map(r => r.status), ['installed', 'installed', 'installed']);
  await service.put('agents', { name: 'New label', agent: { ...agent, instructions: 'Changed' } }, id);
  assert.deepEqual((await service.list('agents'))[0]!.installations.map(r => r.status), ['outdated', 'outdated', 'outdated']);
  assert.equal(toml(await fs.readFile(codex, 'utf8')).developer_instructions, agent.instructions);
  await service.sync('agents', id, destinations);
  await service.sync('agents', id, destinations);
  await service.remove('agents', id);
  assert.deepEqual(await service.list('agents'), []);
  await assert.rejects(fs.stat(codex), { code: 'ENOENT' });
});

test('rejects duplicate, unsafe, immutable names, unsupported fields and empty instructions', async t => {
  const { service } = await setup(t);
  const id = await service.put('agents', { name: 'Specialist', agent });
  await assert.rejects(service.put('agents', { name: 'Duplicate', agent }));
  await assert.rejects(service.put('agents', { name: 'Changed', agent: { ...agent, name: 'renamed' } }, id));
  for (const name of ['../escape', 'UpperCase', 'bad_name', 'constructor', 'x'.repeat(65)]) await assert.rejects(service.put('agents', { name, agent: { ...agent, name } }));
  for (const instructions of ['', '  \n ']) await assert.rejects(service.put('agents', { name: 'Bad', agent: { ...agent, instructions } }));
  await assert.rejects(service.put('agents', { name: 'Bad', content: '---\nname: other\ndescription: Test\nmodel: custom\n---\nInstructions' }), /Unsupported.*model/);
});

test('partial failures preserve unmanaged files and external edits block uninstall and delete', async t => {
  const { options, service } = await setup(t);
  const id = await service.put('agents', { name: 'Specialist', agent });
  const file = path.join(options.codexHome, 'agents', `${agent.name}.toml`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'unmanaged');
  assert.deepEqual((await service.sync('agents', id, destinations)).map(r => r.status), ['conflict', 'installed', 'installed']);
  assert.equal(await fs.readFile(file, 'utf8'), 'unmanaged');
  await fs.rm(file);
  await service.sync('agents', id, ['codex']);
  await fs.appendFile(file, '\n# external');
  assert.equal((await service.sync('agents', id, ['codex'], true))[0]!.status, 'conflict');
  await assert.rejects(service.remove('agents', id));
  assert.equal((await service.list('agents')).length, 1);
});

test('alternate files, configuration entries, built-ins and symlink parents conflict', async t => {
  const { options, service } = await setup(t);
  const id = await service.put('agents', { name: 'Specialist', agent });
  await fs.mkdir(options.codexHome, { recursive: true });
  await fs.writeFile(path.join(options.codexHome, 'config.toml'), `[agents.${agent.name}]\ndescription = "external"\n`);
  assert.equal((await service.sync('agents', id, ['codex']))[0]!.status, 'conflict');
  const folder = path.join(options.configHome, 'opencode/agent');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, `${agent.name}.md`), 'external');
  assert.equal((await service.sync('agents', id, ['opencode']))[0]!.status, 'conflict');
  const builtin = await service.put('agents', { name: 'Build', agent: { ...agent, name: 'build' } });
  assert.equal((await service.sync('agents', builtin, ['opencode']))[0]!.status, 'conflict');
  await fs.mkdir(path.join(options.home, '.gemini/config'), { recursive: true });
  await fs.symlink(options.root, path.join(options.home, '.gemini/config/agents'));
  assert.equal((await service.sync('agents', id, ['antigravity']))[0]!.status, 'conflict');
});

test('symlink files and differently named Antigravity definitions are preserved', async t => {
  const { options, service } = await setup(t);
  const id = await service.put('agents', { name: 'Specialist', agent });
  const folder = path.join(options.home, '.gemini/config/agents');
  await fs.mkdir(folder, { recursive: true });
  const alternate = path.join(folder, 'different.md');
  await fs.writeFile(alternate, `---\nname: ${agent.name}\ndescription: External\n---\nExternal instructions`);
  assert.equal((await service.sync('agents', id, ['antigravity']))[0]!.status, 'conflict');
  await fs.rm(alternate);
  const target = path.join(options.home, 'unmanaged');
  await fs.writeFile(target, 'keep');
  await fs.symlink(target, path.join(folder, `${agent.name}.md`));
  assert.equal((await service.sync('agents', id, ['antigravity']))[0]!.status, 'conflict');
  assert.equal((await service.sync('agents', id, ['antigravity'], true))[0]!.status, 'conflict');
  assert.equal(await fs.readFile(target, 'utf8'), 'keep');
  assert.equal((await fs.lstat(path.join(folder, `${agent.name}.md`))).isSymbolicLink(), true);
});
