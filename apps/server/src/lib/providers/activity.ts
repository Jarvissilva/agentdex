import { readFile, stat } from 'node:fs/promises';
import type { StoredSession } from '@agentdex/shared';
import HttpError from '../HttpError.js';

export type Activity = StoredSession['activity'];

// Linux exposes device numbers as hexadecimal major:minor and decimal inodes.
export async function lockActivity(
  files: string[], platform: string = process.platform, locksPath = '/proc/locks',
): Promise<Activity[]> {
  if (platform !== 'linux') return files.map(() => 'unknown');
  let locks: string;
  try { locks = await readFile(locksPath, 'utf8'); }
  catch { return files.map(() => 'unknown'); }
  const writers = new Set<string>();
  for (const line of locks.split('\n')) {
    const match = /^\d+:\s+(?:FLOCK|POSIX|OFDLCK)\s+\S+\s+WRITE\s+-?\d+\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s/i.exec(line);
    if (match) writers.add(`${BigInt('0x' + match[1])}:${BigInt('0x' + match[2])}:${match[3]}`);
  }
  return Promise.all(files.map(async (file): Promise<Activity> => {
    try {
      const info = await stat(file, { bigint: true });
      const major = ((info.dev >> 8n) & 0xfffn) | ((info.dev >> 32n) & 0xfffff000n);
      const minor = (info.dev & 0xffn) | ((info.dev >> 12n) & 0xffffff00n);
      return writers.has(`${major}:${minor}:${info.ino}`) ? 'active' : 'inactive';
    } catch (error) {
      return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'inactive' : 'unknown';
    }
  }));
}

export function rejectActive(sessions: { activity: Activity }[]): void {
  if (sessions.some((session) => session.activity === 'active')) {
    throw new HttpError(409, 'This session or a child session is active. Close it in its provider before deleting, then refresh and retry.');
  }
}
