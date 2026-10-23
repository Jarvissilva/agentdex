import { createBrowserRouter } from 'react-router';
import AppLayout from '@/layouts/AppLayout';
import ErrorBoundary from '@/pages/ErrorBoundary';
import Home, { homeLoader } from '@/pages/Home';
import Loading from '@/pages/Loading';
import NotFound from '@/pages/NotFound';
import Sessions, { sessionsAction, sessionsLoader } from '@/pages/Sessions';

const router = createBrowserRouter([
  {
    Component: AppLayout,
    ErrorBoundary,
    HydrateFallback: Loading,
    children: [
      { index: true, Component: Home, loader: homeLoader, ErrorBoundary },
      {
        path: 'sessions',
        Component: Sessions,
        loader: sessionsLoader,
        action: sessionsAction,
        ErrorBoundary,
      },
      { path: '*', Component: NotFound },
    ],
  },
]);

export default router;
