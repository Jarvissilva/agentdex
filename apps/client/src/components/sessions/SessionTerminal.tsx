import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalClientMessage, TerminalServerMessage } from '@agentdex/shared';
import '@xterm/xterm/css/xterm.css';

interface Props { sessionId: string; providerName: string; onExit: () => void }

export default function SessionTerminal({ sessionId, providerName, onExit }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('Connecting…');

  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#101113', foreground: '#ececee' },
      scrollback: 2000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    let socket: WebSocket | undefined;
    let disposed = false;
    let exited = false;
    let ready = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;

    const send = (message: TerminalClientMessage) => {
      if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const resize = () => {
      if (disposed || !container.current?.clientWidth || !container.current.clientHeight) return;
      fit.fit();
      send({ type: 'resize', cols: Math.min(500, Math.max(2, terminal.cols)), rows: Math.min(200, Math.max(2, terminal.rows)) });
    };
    const connect = () => {
      if (disposed) return;
      const url = new URL(`/api/sessions/${sessionId}/terminal`, window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      ready = false;
      socket.onmessage = (event: MessageEvent<string>) => {
        if (disposed) return;
        const message = JSON.parse(event.data) as TerminalServerMessage;
        if (message.type === 'snapshot') {
          terminal.reset();
          terminal.write(message.data);
          exited = message.session.status === 'exited';
          ready = !exited;
          delay = 500;
          setConnection(exited ? 'Session ended' : 'Connected');
          resize();
          if (exited) onExit();
          else terminal.focus();
        } else if (message.type === 'output') terminal.write(message.data);
        else if (message.type === 'exit') {
          exited = true;
          ready = false;
          setConnection(`Session ended · exit code ${message.session.exitCode ?? 'unknown'}`);
          onExit();
        }
      };
      socket.onclose = (event) => {
        ready = false;
        if (disposed || exited) return;
        if (event.code === 1008) { setConnection('Terminal connection rejected. Refresh the page to reconnect.'); return; }
        setConnection('Disconnected · reconnecting…');
        onExit();
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 5000);
      };
      socket.onerror = () => socket?.close();
    };

    const input = terminal.onData((value) => send({ type: 'input', data: value }));
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      observer.disconnect();
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [sessionId, onExit]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{connection}</div>
      <div ref={container} aria-label={`${providerName} terminal`} className="h-[65svh] min-h-80 p-3" />
    </div>
  );
}
