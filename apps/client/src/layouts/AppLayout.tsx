import { useCallback, useState } from 'react';
import { Outlet, useNavigation } from 'react-router';
import AppSidebar from '@/components/layout/AppSidebar';

export interface WorkspaceContext {
  explorerOpen: boolean;
  mobileExplorerOpen: boolean;
  closeMobileExplorer: () => void;
  toggleExplorer: () => void;
}

export default function AppLayout() {
  const navigation = useNavigation();
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);
  const toggleExplorer = useCallback(() => {
    if (window.matchMedia('(min-width: 768px)').matches) setExplorerOpen((open) => !open);
    else setMobileExplorerOpen((open) => !open);
  }, []);
  const closeMobileExplorer = useCallback(() => setMobileExplorerOpen(false), []);
  const context: WorkspaceContext = { explorerOpen, mobileExplorerOpen, closeMobileExplorer, toggleExplorer };

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>
      <AppSidebar explorerOpen={explorerOpen} mobileExplorerOpen={mobileExplorerOpen} onToggleExplorer={toggleExplorer} />
      <main id="main-content" tabIndex={-1} aria-busy={navigation.state !== 'idle'} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none">
        <Outlet context={context} />
      </main>
    </div>
  );
}
