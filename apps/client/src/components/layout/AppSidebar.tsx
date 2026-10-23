import { Bot, BookOpen, Command, Plug, Settings, TerminalSquare } from 'lucide-react';
import { Link, useLocation } from 'react-router';

interface Props {
  explorerOpen: boolean;
  mobileExplorerOpen: boolean;
  onToggleExplorer: () => void;
}

export default function AppSidebar({ explorerOpen, mobileExplorerOpen, onToggleExplorer }: Props) {
  const { pathname } = useLocation();
  const inSessions = pathname === '/sessions';
  const iconClass = 'flex size-12 shrink-0 items-center justify-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  return (
    <aside className="z-10 order-last flex shrink-0 items-center border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:order-last md:w-12 md:flex-col md:border-t-0 md:border-l md:pb-0">
      <Link to="/" aria-label="Agentdex home" title="Agentdex" className={`${iconClass} ${pathname === '/' ? 'text-foreground' : ''}`}><Command className="size-5" aria-hidden="true" /></Link>
      <nav aria-label="Main navigation" className="flex md:flex-col">
        {inSessions ? <>
          <button type="button" aria-label="Toggle sessions explorer" title="Sessions" aria-controls="sessions-explorer" aria-expanded={explorerOpen} onClick={onToggleExplorer} className={`${iconClass} hidden border-r-2 border-blue-400 text-foreground md:flex`}><TerminalSquare className="size-5" aria-hidden="true" /></button>
          <button type="button" aria-label="Toggle sessions explorer" title="Sessions" aria-controls="mobile-sessions-explorer" aria-expanded={mobileExplorerOpen} onClick={onToggleExplorer} className={`${iconClass} border-t-2 border-blue-400 text-foreground md:hidden`}><TerminalSquare className="size-5" aria-hidden="true" /></button>
        </> : <Link to="/sessions" aria-label="Sessions" title="Sessions" className={iconClass}><TerminalSquare className="size-5" aria-hidden="true" /></Link>}
        <Link to="/skills" aria-label="Skills" title="Skills" className={`${iconClass} ${pathname === '/skills' ? 'text-blue-400' : ''}`}><BookOpen className="size-5" aria-hidden="true" /></Link>
        <Link to="/agents" aria-label="Agents" title="Agents" className={`${iconClass} ${pathname === '/agents' ? 'text-blue-400' : ''}`}><Bot className="size-5" aria-hidden="true" /></Link>
        <Link to="/mcps" aria-label="MCP servers" title="MCP servers" className={`${iconClass} ${pathname === '/mcps' ? 'text-blue-400' : ''}`}><Plug className="size-5" aria-hidden="true" /></Link>
      </nav>
      <Link to="/settings" aria-label="Settings" title="Settings" className={`${iconClass} ml-auto md:mt-auto md:ml-0 ${pathname === '/settings' ? 'text-blue-400' : ''}`}><Settings className="size-5" aria-hidden="true" /></Link>
    </aside>
  );
}
