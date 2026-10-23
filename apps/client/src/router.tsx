import { panels, legacyWorkspaceLocation } from '@/lib/workspace';
import { createBrowserRouter, replace } from 'react-router';
import ErrorBoundary from '@/pages/ErrorBoundary';
import Loading from '@/pages/Loading';
import NotFound from '@/pages/NotFound';
import Workspace from '@/pages/Workspace';
import { sessionsLoader } from '@/pages/Sessions';

const router = createBrowserRouter([
  {
    ErrorBoundary,
    HydrateFallback: Loading,
    children: [
      { index: true, Component: Workspace, loader: sessionsLoader, ErrorBoundary },
      ...panels.map(panel => ({ path: panel, loader: ({ request }: { request: Request }) => replace(legacyWorkspaceLocation(panel, request.url)) })),
      { path: '*', Component: NotFound },
    ],
  },
]);

export default router;
