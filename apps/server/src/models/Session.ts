import type { Session } from '@agentdex/shared';
import type { IPty } from 'node-pty';
import type { Terminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
import type { EventEmitter } from 'node:events';

export interface SessionRuntime {
  info: Session;
  process: IPty;
  terminal: Terminal;
  serializer: SerializeAddon;
  events: EventEmitter;
}
