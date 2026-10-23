import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { WorkspaceContext } from '@/layouts/AppLayout';

interface Props extends WorkspaceContext {
  children: ReactNode;
}

export default function SessionExplorer({ children, desktop, explorerOpen, mobileExplorerOpen, closeMobileExplorer }: Props) {
  const [width, setWidth] = useState(360);
  const drag = useRef<{ x: number; width: number } | null>(null);
  if (!desktop) return (
    <Dialog.Root open={mobileExplorerOpen} onOpenChange={(open) => { if (!open) closeMobileExplorer(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content id="mobile-sessions-explorer" aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85svh] flex-col rounded-t-xl border border-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-foreground outline-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom">
          <div aria-hidden="true" className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/40" />
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <Dialog.Title className="text-xs font-medium uppercase tracking-wider">Sessions</Dialog.Title>
            <Dialog.Close aria-label="Close sessions explorer" className="rounded p-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /></Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain py-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  return (
    <div className="order-last flex min-h-0 shrink-0 overflow-hidden">
      <aside id="sessions-explorer" aria-label="Sessions explorer" hidden={!explorerOpen} style={{ width }} className="order-last min-h-0 shrink-0 overflow-y-auto overscroll-contain border-l border-border bg-sidebar py-3">{children}</aside>
      {explorerOpen && <div
        role="separator" aria-label="Resize sessions explorer" aria-orientation="vertical" aria-controls="sessions-explorer" aria-valuemin={220} aria-valuemax={480} aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          setWidth((value) => event.key === 'Home' ? 220 : event.key === 'End' ? 480 : Math.max(220, Math.min(480, value + (event.key === 'ArrowLeft' ? 10 : -10))));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width };
        }}
        onPointerMove={(event) => { if (drag.current) setWidth(Math.max(220, Math.min(480, drag.current.width + drag.current.x - event.clientX))); }}
        onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { drag.current = null; }}
        className="z-10 -mr-0.5 w-1 shrink-0 touch-none cursor-col-resize outline-none hover:bg-blue-400 focus-visible:bg-blue-400"
      />}
    </div>
  );
}
