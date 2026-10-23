import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceContext } from '@/layouts/AppLayout';

interface Props extends WorkspaceContext {
  children: ReactNode;
}

export default function SessionExplorer({ children, desktop, explorerOpen, mobileExplorerOpen, closeMobileExplorer, panel }: Props) {
  const [width, setWidth] = useState(360);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (desktop || !mobileExplorerOpen) return;
    const previous = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMobileExplorer(); }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.matches(':disabled'));
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous instanceof HTMLElement) previous.focus(); };
  }, [desktop, mobileExplorerOpen, closeMobileExplorer]);

  return (
    <>
      {!desktop && mobileExplorerOpen && <button type="button" aria-label="Dismiss panel" onClick={closeMobileExplorer} className="fixed inset-0 z-40 bg-black/60" />}
    <div hidden={desktop ? !explorerOpen : !mobileExplorerOpen} className={desktop ? 'order-last flex min-h-0 shrink-0 overflow-hidden' : 'fixed inset-x-0 top-0 bottom-12 z-50 flex bg-sidebar'}>
      <aside ref={panelRef} tabIndex={-1} id={desktop ? 'sessions-explorer' : 'mobile-sessions-explorer'} role={desktop ? 'complementary' : 'dialog'} aria-modal={desktop ? undefined : true} aria-label={`${panel} panel`} style={{ width: desktop ? width : '100%' }} className="order-last flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar outline-none">
        {!desktop && <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2"><span className="text-xs font-medium uppercase tracking-wider">{panel}</span><button type="button" aria-label="Close panel" className="rounded p-2" onClick={closeMobileExplorer}><X className="size-4" /></button></div>}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
      {desktop && explorerOpen && <div
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
    </>
  );
}
