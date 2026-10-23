import { Bot, BookOpen, Plug, Settings, TerminalSquare } from 'lucide-react';
import { Link, useLocation } from 'react-router';

export default function AppSidebar() {
  const { pathname } = useLocation();
  const inSessions = pathname === '/sessions';
  const iconClass = 'flex h-12 min-w-0 flex-1 items-center md:w-12 md:flex-none md:shrink-0 justify-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  return (
    <aside className="z-10 order-last flex shrink-0 items-center border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:order-last md:w-12 md:flex-col md:border-t-0 md:border-l md:pb-0">
      <nav aria-label="Main navigation" className="flex w-full md:flex-1 md:flex-col">
        <Link to="/sessions" aria-label="Sessions" title="Sessions" aria-current={inSessions ? 'page' : undefined} className={`${iconClass} ${inSessions ? 'border-t-2 border-blue-400 text-foreground md:border-t-0 md:border-r-2' : ''}`}><TerminalSquare className="size-5" aria-hidden="true" /></Link>
        <Link to="/skills" aria-label="Skills" title="Skills" className={`${iconClass} ${pathname === '/skills' ? 'text-blue-400' : ''}`}><BookOpen className="size-5" aria-hidden="true" /></Link>
        <Link to="/agents" aria-label="Agents" title="Agents" className={`${iconClass} ${pathname === '/agents' ? 'text-blue-400' : ''}`}><Bot className="size-5" aria-hidden="true" /></Link>
        <Link to="/mcps" aria-label="MCP servers" title="MCP servers" className={`${iconClass} ${pathname === '/mcps' ? 'text-blue-400' : ''}`}><Plug className="size-5" aria-hidden="true" /></Link>
        <Link to="/settings" aria-label="Settings" title="Settings" className={`${iconClass} md:mt-auto ${pathname === '/settings' ? 'text-blue-400' : ''}`}><Settings className="size-5" aria-hidden="true" /></Link>
      </nav>
    </aside>
  );
}
