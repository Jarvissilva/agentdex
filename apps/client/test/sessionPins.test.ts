import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSessionRows, filterSessionRows, visibleSessionRows, parseSessionPins, reconcileSessionPins } from '../src/lib/sessionPins.ts';
import { sessionRowKey, type SessionListRow } from '../src/lib/sessionActivity.ts';

const older: SessionListRow = { kind: 'saved', provider: 'codex', id: 'one', title: 'Old', workingDirectory: '/work', createdAt: null, updatedAt: '2026-10-22T10:00:00Z', archived: false, activity: 'inactive' };
const newer: SessionListRow = { ...older, id: 'two', updatedAt: '2026-10-23T10:00:00Z' };

test('pins survive serialization and malformed browser storage is safe', () => {
  const pins = new Set([sessionRowKey(older)]);
  assert.deepEqual(parseSessionPins(JSON.stringify([...pins])), pins);
  for (const value of [null, 'invalid', '{}', 'null']) assert.deepEqual(parseSessionPins(value), new Set());
  assert.deepEqual(parseSessionPins('[12,"valid",null]'), new Set(['valid']));
});

test('pins sort before newer sessions; unpinning restores recent-first order', () => {
  const pins = new Set([sessionRowKey(older)]);
  assert.deepEqual([newer, older].sort((a, b) => compareSessionRows(a, b, pins)), [older, newer]);
  pins.delete(sessionRowKey(older));
  assert.deepEqual([older, newer].sort((a, b) => compareSessionRows(a, b, pins)), [newer, older]);
  pins.add(sessionRowKey(older)); pins.add(sessionRowKey(newer));
  assert.deepEqual([older, newer].sort((a, b) => compareSessionRows(a, b, pins)), [newer, older]);
});

test('pins distinguish provider identities and saved versus managed rows', () => {
  const otherProvider = { ...older, provider: 'opencode', updatedAt: newer.updatedAt };
  const pins = new Set([sessionRowKey(older)]);
  assert.ok(compareSessionRows(older, otherProvider, pins) < 0);
  assert.equal(pins.has(sessionRowKey(otherProvider)), false);
  const managed: SessionListRow = { ...older, kind: 'managed', terminal: { id: older.id, provider: older.provider, workingDirectory: '/work', startedAt: newer.updatedAt, status: 'running', taskActivity: 'running', exitCode: null } };
  assert.equal(pins.has(sessionRowKey(managed)), false);
});


test('a pin follows a new terminal when provider history becomes available', () => {
  const row: SessionListRow = { ...older, terminal: { id: 'terminal-id', provider: older.provider, providerSessionId: older.id, workingDirectory: '/work', startedAt: newer.updatedAt, status: 'running', taskActivity: 'running', exitCode: null } };
  const terminalKey = JSON.stringify(['managed', row.provider, row.terminal!.id]);
  const pins = new Set([terminalKey]);
  const reconciled = reconcileSessionPins([row], pins);
  assert.deepEqual(reconciled, new Set([sessionRowKey(row)]));
  assert.deepEqual(pins, new Set([terminalKey]));
  assert.equal(reconcileSessionPins([row], reconciled), reconciled);
});

test('persisted pins bypass date, provider, and search filters until unpinned', () => {
  const pins = parseSessionPins(JSON.stringify([sessionRowKey(newer)]));
  const rows = [older, newer];
  const filters = [
    (row: SessionListRow) => row.updatedAt.startsWith('2026-10-22'),
    (row: SessionListRow) => row.updatedAt.startsWith('2026-10-24'),
    (row: SessionListRow) => row.provider === 'opencode',
    (row: SessionListRow) => row.title.includes('no match'),
  ];
  for (const matches of filters) {
    const visible = filterSessionRows(rows, pins, matches);
    assert.ok(visible.includes(newer));
    pins.delete(sessionRowKey(newer));
    assert.equal(filterSessionRows(rows, pins, matches).includes(newer), matches(newer));
    pins.add(sessionRowKey(newer));
  }
  const matching = filterSessionRows(rows, pins, () => false);
  assert.deepEqual(matching, [newer]);
});

test('all pins survive pagination and collapsed directories without duplication', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ ...older, id: String(index) }));
  const pins = new Set(rows.slice(0, 7).map(sessionRowKey));
  const sorted = rows.sort((a, b) => compareSessionRows(a, b, pins));
  assert.deepEqual(visibleSessionRows(sorted, pins, 5, false), sorted);
  assert.deepEqual(visibleSessionRows(sorted, pins, 5, true), sorted.slice(0, 7));
  assert.deepEqual(visibleSessionRows(sorted, pins, 2, false), sorted.slice(0, 9));
  assert.deepEqual(visibleSessionRows(sorted, new Set(), 5, true), []);
  assert.deepEqual(visibleSessionRows(sorted, new Set(), 5, false), sorted.slice(0, 5));
});
