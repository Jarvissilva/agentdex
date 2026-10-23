import { Outlet, useNavigation } from 'react-router';
import AppSidebar from '@/components/layout/AppSidebar';

export default function AppLayout() {
  const navigation = useNavigation();

  return (
    <div className="min-h-svh md:grid md:grid-cols-[220px_1fr]">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <AppSidebar />
      <main
        id="main-content"
        tabIndex={-1}
        aria-busy={navigation.state !== 'idle'}
        className="min-w-0 outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
