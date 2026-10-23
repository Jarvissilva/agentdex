import type { ProviderAdapter } from './types.js';
import listCodexSessions from './codexSessions.js';

const codex: ProviderAdapter = {
  id: 'codex',
  name: 'Codex',
  installationHint: 'Install Codex or set CODEX_BIN to its executable path.',
  getLaunchConfig: () => ({
    executable: process.env.CODEX_BIN || 'codex',
    args: [],
  }),
  listSessions: () => listCodexSessions(codex.getLaunchConfig('').executable),
};

export default codex;
