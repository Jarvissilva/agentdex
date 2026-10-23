import { createBrowserRouter, redirect } from 'react-router';
import AppLayout from '@/layouts/AppLayout';
import ErrorBoundary from '@/pages/ErrorBoundary';
import Loading from '@/pages/Loading';
import NotFound from '@/pages/NotFound';
import Sessions, { sessionsAction, sessionsLoader } from '@/pages/Sessions';

const router = createBrowserRouter([
  {
    Component: AppLayout,
    ErrorBoundary,
    HydrateFallback: Loading,
    children: [
      { index: true, loader: () => redirect('/sessions') },
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
