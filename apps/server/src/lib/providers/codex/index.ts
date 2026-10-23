import type { ProviderAdapter } from '../types.js';
import listCodexSessions from './sessions.js';

const codex: ProviderAdapter = {
  id: 'codex',
  name: 'Codex',
  installationHint: 'Install Codex or set CODEX_BIN to its executable path.',
  getLaunchConfig: () => ({
    executable: process.env.CODEX_BIN || 'codex',
    args: [],
  }),
  getResumeConfig: (directory, sessionId) => ({ ...codex.getLaunchConfig(directory), args: ['resume', sessionId] }),
  renameSession: async (id, title) => { await listCodexSessions(codex.getLaunchConfig('').executable, id, title); },
  deleteSession: async (id) => { await listCodexSessions(codex.getLaunchConfig('').executable, id); },
  listSessions: () => listCodexSessions(codex.getLaunchConfig('').executable),
};

export default codex;
