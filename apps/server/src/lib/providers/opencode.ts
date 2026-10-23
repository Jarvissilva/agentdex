import type { ProviderAdapter } from './types.js';
import listOpenCodeSessions from './opencodeSessions.js';

const opencode: ProviderAdapter = {
  id: 'opencode',
  name: 'OpenCode',
  installationHint: 'Install OpenCode or set OPENCODE_BIN to its executable path.',
  getLaunchConfig: () => ({ executable: process.env.OPENCODE_BIN || 'opencode', args: [] }),
  listSessions: () => listOpenCodeSessions(opencode.getLaunchConfig('').executable),
};

export default opencode;
