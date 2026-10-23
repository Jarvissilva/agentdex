import type { ProviderAdapter } from '../types.js';
import listOpenCodeSessions, { deleteOpenCodeSession, renameOpenCodeSession } from './sessions.js';

const opencode: ProviderAdapter = {
  id: 'opencode',
  name: 'OpenCode',
  installationHint: 'Install OpenCode or set OPENCODE_BIN to its executable path.',
  getLaunchConfig: () => ({ executable: process.env.OPENCODE_BIN || 'opencode', args: [] }),
  getResumeConfig: (directory, sessionId) => ({ ...opencode.getLaunchConfig(directory), args: ['--session', sessionId] }),
  renameSession: (id, title) => renameOpenCodeSession(opencode.getLaunchConfig('').executable, id, title),
  deleteSession: (id) => deleteOpenCodeSession(opencode.getLaunchConfig('').executable, id),
  listSessions: () => listOpenCodeSessions(opencode.getLaunchConfig('').executable),
};

export default opencode;
