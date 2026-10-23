import deleteAntigravitySession from './delete.js';
import type { ProviderAdapter } from '../types.js';
import listAntigravitySessions, { renameAntigravitySession } from './sessions.js';

const agy: ProviderAdapter = {
  id: 'agy',
  name: 'Antigravity CLI',
  installationHint: 'Install Antigravity CLI or set AGY_BIN to its executable path.',
  getLaunchConfig: () => ({ executable: process.env.AGY_BIN || 'agy', args: [] }),
  getResumeConfig: (directory, sessionId) => ({ ...agy.getLaunchConfig(directory), args: ['--conversation', sessionId] }),
  renameSession: (id, title) => renameAntigravitySession(id, title),
  deleteSession: (id) => deleteAntigravitySession(id),
  listSessions: () => listAntigravitySessions(),
};

export default agy;
