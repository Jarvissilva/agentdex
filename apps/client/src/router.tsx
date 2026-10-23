import { createBrowserRouter } from 'react-router';
import ErrorBoundary from '@/pages/ErrorBoundary';
import Loading from '@/pages/Loading';
import NotFound from '@/pages/NotFound';
import Workspace from '@/pages/Workspace';
import { workspaceLoader } from '@/lib/workspaceLoader';

const router = createBrowserRouter([
  {
    ErrorBoundary,
    HydrateFallback: Loading,
    children: [
      { index: true, Component: Workspace, loader: workspaceLoader, ErrorBoundary },
      { path: '*', Component: NotFound },
    ],
  },
]);

export default router;
