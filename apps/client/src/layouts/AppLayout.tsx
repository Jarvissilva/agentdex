import type { ReactNode } from 'react';
import type { WorkspacePanel } from '@/lib/workspace';
import AppSidebar from '@/components/layout/AppSidebar';

export interface WorkspaceContext {
  panel: WorkspacePanel;
  selectPanel: (panel: WorkspacePanel) => void;
  desktop: boolean;
  explorerOpen: boolean;
  mobileExplorerOpen: boolean;
  closeMobileExplorer: () => void;
  toggleExplorer: () => void;
}

export default function AppLayout({ workspace, children }: { workspace: WorkspaceContext; children: ReactNode }) {
  const { panel, selectPanel } = workspace;

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>
      <AppSidebar panel={panel} onSelect={selectPanel} />
      <main id="main-content" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none">
        {children}
      </main>
    </div>
  );
}
