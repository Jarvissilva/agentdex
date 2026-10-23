import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalClientMessage, TerminalServerMessage } from '@agentdex/shared';
import { terminalColors, terminalTheme } from '@agentdex/shared/terminal-theme.js';
import '@xterm/xterm/css/xterm.css';

interface Props {
  sessionId: string;
  providerName: string;
  onExit: () => void;
}

export default function SessionTerminal({ sessionId, providerName, onExit }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('Connecting…');

  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: terminalTheme,
      allowProposedApi: true,
      scrollback: 2000,
    });
    // The server owns color query replies, including when no browser is attached.
    // Consume the query here so each connected browser does not reply again.
    for (const command of Object.keys(terminalColors)) {
      terminal.parser.registerOscHandler(Number(command), (data) => data === '?');
    }
    terminal.parser.registerOscHandler(7501, () => true);
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    // Draw box/block glyphs on the cell grid instead of relying on font metrics.
    // Keep the DOM renderer available on devices without a usable WebGL context.
    const webgl = new WebglAddon();
    try {
      terminal.loadAddon(webgl);
      webgl.onContextLoss(() => webgl.dispose());
    } catch { webgl.dispose(); }
    let socket: WebSocket | undefined;
    let disposed = false;
    let exited = false;
    let ready = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    let replaying = false;
    let fontsReady = false;
    let lastSize: { cols: number; rows: number } | undefined;

    const send = (message: TerminalClientMessage) => {
      if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const resize = () => {
      if (disposed || replaying || !fontsReady || !container.current?.clientWidth || !container.current.clientHeight) return;
      const dimensions = fit.proposeDimensions();
      if (!dimensions) return;
      const cols = Math.min(500, Math.max(2, dimensions.cols));
      const rows = Math.min(200, Math.max(2, dimensions.rows));
      if (terminal.cols !== cols || terminal.rows !== rows) terminal.resize(cols, rows);
      if (ready && (lastSize?.cols !== cols || lastSize.rows !== rows)) {
        send({ type: 'resize', cols, rows });
        lastSize = { cols, rows };
      }
    };
    const connect = () => {
      if (disposed) return;
      const url = new URL(`/api/sessions/${sessionId}/terminal`, window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const connectionSocket = new WebSocket(url);
      socket = connectionSocket;
      let messages = Promise.resolve();
      lastSize = undefined;
      ready = false;
      replaying = false;
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as TerminalServerMessage;
        messages = messages.then(async () => {
          if (disposed || socket !== connectionSocket) return;
          if (message.type === 'snapshot') {
            replaying = true;
            ready = false;
            terminal.reset();
            terminal.resize(message.cols, message.rows);
            await new Promise<void>((resolve) => terminal.write(message.data, resolve));
            if (disposed || socket !== connectionSocket) return;
            replaying = false;
            lastSize = { cols: message.cols, rows: message.rows };
            exited = message.session.status === 'exited';
            ready = !exited && connectionSocket.readyState === WebSocket.OPEN;
            delay = 500;
            setConnection(exited ? 'Session ended' : 'Connected');
            resize();
            if (exited) onExit();
            else terminal.focus();
          } else if (message.type === 'output') {
            await new Promise<void>((resolve) => terminal.write(message.data, resolve));
          } else if (message.type === 'exit') {
            exited = true;
            ready = false;
            setConnection(`Session ended · exit code ${message.session.exitCode ?? 'unknown'}`);
            onExit();
          }
        });
      };
      socket.onclose = (event) => {
        ready = false;
        // Drain the final output and exit frames before deciding to reconnect.
        void messages.then(() => {
          if (disposed || socket !== connectionSocket || exited) return;
          if (event.code === 1008) { setConnection('Terminal connection rejected. Refresh the page to reconnect.'); return; }
          setConnection('Disconnected · reconnecting…');
          onExit();
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 5000);
        });
      };
      socket.onerror = () => connectionSocket.close();
    };

    const input = terminal.onData((value) => send({ type: 'input', data: value }));
    const binaryInput = terminal.onBinary((value) => send({ type: 'input', data: value, encoding: 'binary' }));
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    void document.fonts.ready.then(() => {
      if (disposed) return;
      fontsReady = true;
      resize();
    });
    document.fonts.addEventListener('loadingdone', resize);
    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', resize);
      input.dispose();
      binaryInput.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [sessionId, onExit]);

  return (
    <div className="flex min-h-48 flex-1 flex-col overflow-hidden rounded border border-border bg-background">
      {connection !== 'Connected' && !connection.startsWith('Session ended') && <div role="status" className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">{connection}</div>}
      <div ref={container} aria-label={`${providerName} terminal`} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
