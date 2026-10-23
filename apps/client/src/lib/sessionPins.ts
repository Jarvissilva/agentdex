import { sessionRowKey, type SessionListRow } from './sessionActivity.ts';

export const sessionPinsStorageKey = 'agentdex:pinned-sessions';

export function parseSessionPins(value: string | null): Set<string> {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []);
  } catch { return new Set(); }
}

export function compareSessionRows(a: SessionListRow, b: SessionListRow, pins: ReadonlySet<string>): number {
  return Number(pins.has(sessionRowKey(b))) - Number(pins.has(sessionRowKey(a)))
    || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

export function reconcileSessionPins(rows: SessionListRow[], pins: Set<string>): Set<string> {
  let next = pins;
  for (const row of rows) {
    if (row.kind !== 'saved' || !row.terminal) continue;
    const terminalKey = JSON.stringify(['managed', row.provider, row.terminal.id]);
    if (!next.has(terminalKey)) continue;
    if (next === pins) next = new Set(pins);
    next.delete(terminalKey);
    next.add(sessionRowKey(row));
  }
  return next;
}
