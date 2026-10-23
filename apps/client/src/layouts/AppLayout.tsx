import { useCallback, useEffect, useState } from 'react';
import { Outlet, useNavigation } from 'react-router';
import AppSidebar from '@/components/layout/AppSidebar';

export interface WorkspaceContext {
  desktop: boolean;
  explorerOpen: boolean;
  mobileExplorerOpen: boolean;
  closeMobileExplorer: () => void;
  toggleExplorer: () => void;
}

export default function AppLayout() {
  const navigation = useNavigation();
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);
  const toggleExplorer = useCallback(() => {
    if (window.matchMedia('(min-width: 768px)').matches) setExplorerOpen((open) => !open);
    else setMobileExplorerOpen((open) => !open);
  }, []);
  const closeMobileExplorer = useCallback(() => setMobileExplorerOpen(false), []);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setDesktop(media.matches);
      if (media.matches) setMobileExplorerOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const context: WorkspaceContext = { desktop, explorerOpen, mobileExplorerOpen, closeMobileExplorer, toggleExplorer };

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>
      <AppSidebar />
      <main id="main-content" tabIndex={-1} aria-busy={navigation.state !== 'idle'} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none">
        <Outlet context={context} />
      </main>
    </div>
  );
}
