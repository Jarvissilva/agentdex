import { open } from 'node:fs/promises';
import type { Session } from '@agentdex/shared';

// Read only the bounded tail of a provider-owned rollout, never the full history.
export async function codexRolloutActivity(file: string): Promise<Session['taskActivity']> {
  let handle;
  try {
    handle = await open(file, 'r');
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - 1024 * 1024);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start) lines.shift(); // The first record may start before the bounded tail.
    lines.pop(); // An unterminated record may still be in the writer's buffer.
    for (let index = lines.length - 1; index >= 0; index--) {
      let value: unknown;
      try { value = JSON.parse(lines[index]!); } catch { continue; }
      if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'event_msg'
        || !('payload' in value) || !value.payload || typeof value.payload !== 'object') continue;
      const payload = value.payload;
      if (!('type' in payload)) continue;
      // Child task completion must not mark its still-running root turn Ready.
      if ('root_turn_id' in payload && typeof payload.root_turn_id === 'string'
        && 'turn_id' in payload && typeof payload.turn_id === 'string' && payload.root_turn_id !== payload.turn_id) continue;
      if (payload.type === 'task_complete' || payload.type === 'turn_aborted') return 'not-running';
      if (payload.type === 'task_started') return 'running';
    }
  } catch { /* Missing, rotated or unreadable rollouts are not task telemetry. */ }
  finally { await handle?.close(); }
  return 'unknown';
}
