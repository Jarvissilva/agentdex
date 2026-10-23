import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { StoredSession } from '@agentdex/shared';
import ProviderRegistry from '../src/lib/providers/index.js';
import codex from '../src/lib/providers/codex/index.js';
import listCodexSessions from '../src/lib/providers/codex/sessions.js';
import SessionHistoryService from '../src/services/SessionHistoryService.js';

const session: StoredSession = {
  activity: 'unknown', id: 'same-native-id', title: 'Existing external session', workingDirectory: '/outside/agentdex',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', archived: false,
};

test('aggregates outside history across providers, keeps colliding native IDs and isolates failures', async () => {
  const registry = new ProviderRegistry([
    { ...codex, listSessions: async () => [session, session] },
    { ...codex, id: 'other', name: 'Other', listSessions: async () => [{ ...session, updatedAt: '2026-02-01T00:00:00.000Z', archived: true }] },
    { ...codex, id: 'broken', name: 'Broken', listSessions: async () => { throw new Error('History unavailable'); } },
  ]);
  const result = await new SessionHistoryService(registry).list();
  assert.equal(result.sessions.length, 2);
  assert.deepEqual(result.sessions.map((entry) => entry.provider), ['other', 'codex']);
  assert.equal(result.sessions[0]?.archived, true);
  assert.equal(result.sessions[1]?.workingDirectory, '/outside/agentdex');
  assert.deepEqual(result.discoveryErrors, [{ provider: 'broken', error: 'History unavailable' }]);
});

test('coalesces concurrent discovery calls but refreshes the next request', async () => {
  let calls = 0;
  const registry = new ProviderRegistry([{ ...codex, listSessions: async () => { calls++; return [session]; } }]);
  const history = new SessionHistoryService(registry);
  await Promise.all([history.list(), history.list()]);
  assert.equal(calls, 1);
  await history.list();
  assert.equal(calls, 2);
});

test('Codex discovery initializes the protocol, fetches all pages and archives, and deduplicates IDs', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = path.join(directory, 'codex');
  const fixture = await readFile(new URL('./fixtures/codex-server.mjs', import.meta.url), 'utf8');
  await writeFile(command, fixture.replace('#!/usr/bin/env node', `#!${process.execPath}`), { mode: 0o755 });
  const sessions = await listCodexSessions(command);
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map((entry) => entry.id), ['first', 'second', 'archived']);
  assert.equal(sessions[0]?.title, 'External first');
  assert.equal(sessions[2]?.title, 'Archived title');
  assert.equal(sessions[2]?.archived, true);
  assert.equal(sessions[0]?.workingDirectory, '/external/project');
});

test('Codex discovery reports process exits and protocol errors', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentdex-history-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const exited = path.join(directory, 'exited');
  await writeFile(exited, `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o755 });
  await assert.rejects(listCodexSessions(exited), /exited before completing/);
  const invalid = path.join(directory, 'invalid');
  await writeFile(invalid, `#!${process.execPath}\nprocess.stdin.on('data', () => process.stdout.write('invalid JSON\\n'));\n`, { mode: 0o755 });
  await assert.rejects(listCodexSessions(invalid), /invalid discovery response/);
});

test('invalidation does not reuse discovery begun before deletion', async () => {
  const completions: (() => void)[] = [];
  const history = new SessionHistoryService(new ProviderRegistry([{ ...codex, listSessions: () => new Promise((resolve) => { completions.push(() => resolve([])); }) }]));
  const old = history.list();
  history.invalidate();
  const fresh = history.list();
  assert.notEqual(old, fresh);
  completions[0]!();
  await old;
  assert.equal(history.list(), fresh);
  completions[1]!();
  await fresh;
});
