import path from 'node:path';
import { homedir } from 'node:os';

export const dataPath = path.join(homedir(), '.local', 'share', 'agentdex');
