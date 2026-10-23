import { Command, TerminalSquare } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { cn } from '@/lib/utils';

export default function AppSidebar() {
  return (
    <aside className="flex flex-col border-b border-border bg-sidebar p-4 md:sticky md:top-0 md:h-svh md:border-r md:border-b-0">
      <Link to="/sessions" className="flex w-fit items-center gap-2.5 rounded-md px-2 py-2 font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-7 items-center justify-center rounded-lg border border-border bg-background">
          <Command className="size-4" aria-hidden="true" />
        </span>
        Agentdex
      </Link>
      <nav aria-label="Main navigation" className="mt-5">
        <NavLink
          to="/sessions"
          className={({ isActive }) => cn(
            'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          <TerminalSquare className="size-4" aria-hidden="true" />
          Sessions
        </NavLink>
      </nav>
      <div className="mt-auto hidden items-center gap-2 px-3 pt-6 text-xs text-muted-foreground md:flex">
        <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
        Local workspace
      </div>
    </aside>
  );
}
