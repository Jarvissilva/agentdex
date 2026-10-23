import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProviderSession, Session } from '@agentdex/shared';
import { buildSessionRows, savedSessionActivity, sessionRowActivity, sessionRowKey } from '../src/lib/sessionActivity.ts';

const saved: ProviderSession = { provider: 'codex', id: 'saved', title: '', workingDirectory: '/work', createdAt: null, updatedAt: '', archived: false, activity: 'active' };
const terminal: Session = { provider: 'codex', id: 'terminal', providerSessionId: 'saved', workingDirectory: '/work', status: 'running', taskActivity: 'running', startedAt: '', exitCode: null };

test('held writer/presence locks never imply a working external task', () => {
  for (const provider of ['codex', 'agy']) {
    assert.equal(savedSessionActivity({ ...saved, provider }), 'unknown');
    assert.equal(savedSessionActivity({ ...saved, provider, activity: 'inactive' }), 'inactive');
    assert.equal(savedSessionActivity({ ...saved, provider, activity: 'unknown' }), 'unknown');
  }
});

test('live managed task reports determine work, input, idle and unknown states', () => {
  for (const [taskActivity, expected] of [['running', 'active'], ['needs-input', 'needs-input'], ['not-running', 'inactive'], ['unknown', 'active']] as const) {
    assert.equal(savedSessionActivity(saved, { ...terminal, taskActivity }), expected);
  }
});

test('opening then exiting a managed terminal does not change external status', () => {
  for (const provider of ['codex', 'agy', 'opencode']) {
    for (const activity of ['active', 'inactive', 'unknown'] as const) {
      const session = { ...saved, provider, activity };
      assert.equal(savedSessionActivity(session, { ...terminal, status: 'exited' }), savedSessionActivity(session));
    }
  }
  assert.equal(savedSessionActivity({ ...saved, provider: 'opencode' }), 'active');
});

const providers = [{ id: 'agy', name: 'Antigravity' }];

test('new managed terminals appear without saved history and follow explicit task signals', () => {
  for (const [taskActivity, expected] of [['unknown', 'active'], ['running', 'active'], ['needs-input', 'needs-input'], ['not-running', 'inactive']] as const) {
    const live = { ...terminal, provider: 'agy', providerSessionId: undefined, taskActivity, startedAt: '2026-10-23T10:00:00Z' };
    const rows = buildSessionRows([], [live], providers);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, 'managed');
    assert.equal(rows[0]?.title, 'New Antigravity session');
    assert.equal(rows[0]?.workingDirectory, live.workingDirectory);
    assert.equal(rows[0]?.updatedAt, live.startedAt);
    assert.equal(sessionRowActivity(rows[0]!), expected);
    assert.equal(buildSessionRows([], [{ ...live, status: 'exited' }], providers).length, 0);
  }
});

test('deduplication requires exact provider and saved ID, never directory or time', () => {
  assert.equal(buildSessionRows([saved], [terminal], providers).length, 1);
  for (const live of [{ ...terminal, providerSessionId: undefined }, { ...terminal, providerSessionId: 'different' }, { ...terminal, provider: 'agy' }]) {
    assert.equal(buildSessionRows([saved], [live], providers).length, 2);
  }
  const rows = buildSessionRows([saved], [{ ...terminal, id: saved.id, providerSessionId: undefined }], providers);
  assert.notEqual(sessionRowKey(rows[0]!), sessionRowKey(rows[1]!));
});

test('a live match wins over an exited terminal and external locks remain unknown', () => {
  const rows = buildSessionRows([saved], [terminal, { ...terminal, id: 'exited', status: 'exited' }], providers);
  assert.equal(sessionRowActivity(rows[0]!), 'active');
  assert.equal(sessionRowActivity(buildSessionRows([saved], [], providers)[0]!), 'unknown');
});
