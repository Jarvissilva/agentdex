import type { ReactNode } from 'react';

export default function EditorFrame({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return <>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">{children}</div>
    <footer className="flex shrink-0 gap-2 border-t border-border p-3">{footer}</footer>
  </>;
}
