import type { ReactNode } from 'react';

export default function WorkspaceTabBar({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return <div className="flex min-w-0 shrink-0 items-center border-b border-border bg-sidebar">
    <div className="flex min-w-0 flex-1 items-center overflow-x-auto">{children}</div>
    {actions}
  </div>;
}
