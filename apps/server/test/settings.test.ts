import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import SettingsService from '../src/services/SettingsService.js';
import ModelService, { launchArguments, parseModels, parseAntigravityOutput } from '../src/services/ModelService.js';
import ProviderRegistry from '../src/lib/providers/index.js';
import SessionService from '../src/services/SessionService.js';
import type { SessionRuntime } from '../src/models/Session.js';

test('settings defaults, persistence across restart, and invalid updates', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  const service = new SettingsService(file, directory);
  const defaults = await service.get();
  assert.equal(defaults.defaultProviderId, 'codex');
  assert.deepEqual(defaults.terminal, { fontSize: 14, scrollback: 2000 });
  const settings = { ...defaults, defaultProviderId: 'agy', terminal: { fontSize: 24, scrollback: 0 } };
  await service.save(settings);
  assert.deepEqual(await new SettingsService(file).get(), settings);
  const before = await readFile(file, 'utf8');
  for (const value of [null, {}, { ...settings, terminal: { fontSize: 9, scrollback: 2000 } }, { ...settings, terminal: { fontSize: 14, scrollback: 10001 } }, { ...settings, defaultProviderId: 'missing' }, { ...settings, startingDirectory: 'relative' }, { ...settings, providers: { ...settings.providers, opencode: { model: '', reasoning: 'high' } } }]) {
    await assert.rejects(service.save(value));
    assert.equal(await readFile(file, 'utf8'), before);
  }
  await writeFile(file, '{broken');
  await assert.rejects(service.get(), /malformed/);
  await assert.rejects(service.save(defaults), /malformed/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('exact launch arguments and unchanged provider resume configs', () => {
  for (const id of ['codex', 'agy', 'opencode']) assert.deepEqual(launchArguments(id, { model: '', reasoning: '' }), []);
  assert.deepEqual(launchArguments('codex', { model: 'custom', reasoning: 'high' }), ['--model', 'custom', '--config', 'model_reasoning_effort="high"']);
  assert.deepEqual(launchArguments('agy', { model: 'custom', reasoning: 'high' }), ['--model', 'custom', '--effort', 'high']);
  assert.deepEqual(launchArguments('opencode', { model: 'provider/model', reasoning: 'high' }), ['--model', 'provider/model#high']);
  const registry = new ProviderRegistry();
  assert.deepEqual(registry.get('codex').getResumeConfig?.('/tmp', 'saved').args, ['resume', 'saved']);
  assert.deepEqual(registry.get('agy').getResumeConfig?.('/tmp', 'saved').args, ['--conversation', 'saved']);
  assert.deepEqual(registry.get('opencode').getResumeConfig?.('/tmp', 'saved').args, ['--session', 'saved']);
  for (const p of registry.list()) assert.deepEqual(registry.get(p.id).getLaunchConfig('/tmp').args, []);
});

test('model catalogs preserve IDs and validate model-specific reasoning', async () => {
  const models = parseModels('codex', { data: [{ id: 'internal', model: 'actual', displayName: 'Actual', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] });
  assert.deepEqual(models, [{ id: 'actual', label: 'Actual', reasoning: ['high'] }]);
  assert.deepEqual(parseModels('opencode', { data: [{ id: 'm', providerID: 'p', name: 'Model', variants: [{ id: 'fast' }] }] }), [{ id: 'p/m', label: 'Model', reasoning: ['fast'] }]);
  assert.throws(() => parseModels('agy', { unexpected: true }), /unsupported/);
  const service = new ModelService(new ProviderRegistry());
  service.list = async () => ({ status: 'available', models });
  await assert.rejects(service.validate('codex', '/tmp', { model: 'actual', reasoning: 'invalid' }), /does not support/);
  await service.validate('codex', '/tmp', { model: 'custom', reasoning: 'custom' });
  await assert.rejects(service.validate('opencode', '/tmp', { model: '', reasoning: 'high' }), /Choose/);
});

test('discovery failures are cached and custom IDs remain launchable', async () => {
  const registry = new ProviderRegistry([{ id: 'codex', name: 'Missing', installationHint: 'Set CODEX_BIN.', getLaunchConfig: () => ({ executable: '/missing/provider', args: [] }), listSessions: async () => [], deleteSession: async () => {} }]);
  const service = new ModelService(registry);
  const first = await service.list('codex', '/tmp');
  assert.equal(first.status, 'unavailable');
  assert.match(first.error!, /custom model ID/);
  assert.equal(await service.list('codex', '/tmp'), first);
  assert.notEqual(await service.list('codex', '/tmp', true), first);
  await service.validate('codex', '/tmp', { model: 'custom', reasoning: 'custom' });
});

test('cleanup retains running sessions, returns partial failures, and supports retry', () => {
  const service = new SessionService();
  let disposed = 0;
  const runtimes = (service as unknown as { runtimes: Map<string, SessionRuntime> }).runtimes;
  const runtime = (id: string, status: 'running' | 'exited', dispose: () => void) => ({ info: { id, status }, dispose }) as SessionRuntime;
  runtimes.set('running', runtime('running', 'running', () => { throw new Error('Must never dispose'); }));
  runtimes.set('ended', runtime('ended', 'exited', () => { disposed++; }));
  runtimes.set('retry', runtime('retry', 'exited', () => { throw new Error('Temporary'); }));
  assert.deepEqual(service.clearMemory(), { clearedIds: ['ended'], failures: [{ id: 'retry', error: 'Unable to clear this terminal. Retry cleanup.' }] });
  assert.equal(disposed, 1);
  assert.equal(service.getRuntime('running').info.status, 'running');
  assert.throws(() => service.getRuntime('ended'), /not found/);
  runtimes.get('retry')!.dispose = () => { disposed++; };
  assert.deepEqual(service.clearMemory(), { clearedIds: ['retry'], failures: [] });
  assert.deepEqual(service.clearMemory(), { clearedIds: [], failures: [] });
});


test('Antigravity text catalogs retain explicit IDs and reject unknown output', () => {
  assert.deepEqual(parseModels('agy', parseAntigravityOutput('Available models:\n  exact-id (Model label)\n')), [{ id: 'exact-id', label: 'Model label', reasoning: [], reasoningKnown: false }]);
  assert.throws(() => parseAntigravityOutput('Unexpected output'), /Unsupported/);
});
