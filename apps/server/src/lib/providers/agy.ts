import type { ProviderAdapter } from './types.js';
import listAntigravitySessions from './agySessions.js';

const agy: ProviderAdapter = {
  id: 'agy',
  name: 'Antigravity CLI',
  installationHint: 'Install Antigravity CLI or set AGY_BIN to its executable path.',
  getLaunchConfig: () => ({ executable: process.env.AGY_BIN || 'agy', args: [] }),
  listSessions: () => listAntigravitySessions(),
};

export default agy;
