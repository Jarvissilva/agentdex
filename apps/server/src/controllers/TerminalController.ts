import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Session, TerminalServerMessage } from '@agentdex/shared';
import type SessionService from '../services/SessionService.js';

export default function attachTerminals(server: Server, sessions: SessionService, authorize: (request: IncomingMessage) => boolean) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    const match = /^\/api\/sessions\/([a-zA-Z0-9-]+)\/terminal$/.exec(request.url || '');
    if (!authorize(request)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!match?.[1]) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    let runtime;
    try { runtime = sessions.getRuntime(match[1]); } catch {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      const send = (message: TerminalServerMessage) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (client.bufferedAmount > 1024 * 1024) { client.close(1013, 'Terminal client is too slow.'); return; }
        client.send(JSON.stringify(message));
      };
      const removed = () => client.close(1008, 'Terminal memory cleared.');
      runtime.events.on('removed', removed);
      const output = (value: string) => send({ type: 'output', data: value });
      const exit = (session: Session) => {
        send({ type: 'exit', session });
        client.close(1000, 'Session exited.');
      };
      client.on('error', () => client.close());
      client.on('close', () => {
        runtime.events.off('removed', removed);
        runtime.events.off('output', output);
        runtime.events.off('exit', exit);
      });
      runtime.terminal.write('', () => {
        if (client.readyState !== WebSocket.OPEN) return;
        send({ type: 'snapshot', data: runtime.serializer.serialize() + runtime.mouseEncoding(), cols: runtime.terminal.cols, rows: runtime.terminal.rows, scrollback: runtime.terminal.options.scrollback, session: { ...runtime.info } });
        if (runtime.info.status === 'exited') { client.close(1000, 'Session exited.'); return; }
        runtime.events.on('output', output);
        runtime.events.on('exit', exit);
      });
      client.on('message', (raw, binary) => {
        if (binary) { client.close(1003, 'JSON messages required.'); return; }
        try {
          const message: unknown = JSON.parse(raw.toString());
          if (!message || typeof message !== 'object' || !('type' in message)) throw new Error('Invalid message');
          if (runtime.info.status !== 'running') return;
          if (message.type === 'input' && 'data' in message && typeof message.data === 'string'
            && (!('encoding' in message) || message.encoding === 'binary')) {
            runtime.process.write('encoding' in message ? Buffer.from(message.data, 'latin1') : message.data);
          } else if (message.type === 'resize' && 'cols' in message && 'rows' in message
            && typeof message.cols === 'number' && Number.isInteger(message.cols) && message.cols >= 2 && message.cols <= 500
            && typeof message.rows === 'number' && Number.isInteger(message.rows) && message.rows >= 2 && message.rows <= 200) {
            runtime.terminal.resize(message.cols, message.rows);
            runtime.process.resize(message.cols, message.rows);
          } else throw new Error('Invalid message');
        } catch { client.close(1008, 'Invalid terminal message.'); }
      });
    });
  });

  return () => {
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  };
}
