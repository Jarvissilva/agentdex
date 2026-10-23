import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

export default async function resolveExecutable(executable: string, searchPath: string | undefined): Promise<string | null> {
  const candidates = executable.includes('/')
    ? [path.resolve(executable)]
    : (searchPath || '').split(path.delimiter).map((directory) => path.join(directory, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}
