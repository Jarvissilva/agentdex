import { useState, type ComponentProps } from 'react';
import { ListFilter, Search, Plus, RefreshCw } from 'lucide-react';
import { Popover } from 'radix-ui';
import SessionList from '@/components/sessions/SessionList';
import { Button } from '@/components/ui/shadcn/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import type { SessionStatusFilter } from '@/lib/sessionActivity';
import type { SessionsResponse } from '@agentdex/shared';

type Props = Omit<ComponentProps<typeof SessionList>, 'activity' | 'onActivityChange' | 'search' | 'provider' | 'dateRange' | 'groupByDirectory'> & {
 discoveryErrors: SessionsResponse['discoveryErrors']; refreshError: string; refreshState: 'idle' | 'loading'; pending: boolean; onCreate: () => void;
};
export default function SessionsPanel({ discoveryErrors, refreshError, refreshState, pending, onCreate, ...listProps }: Props) {
 const { providers, refresh: revalidate } = listProps;
  const [dateRange, setDateRange] = useState('today');
  const dateOptions = [{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7days', label: 'Last 7 days' }, { value: '30days', label: 'Last 30 days' }, { value: 'all', label: 'All time' }];
  const [activity, setActivity] = useState<SessionStatusFilter>('all');
  const statusOptions = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Running' }, { value: 'needs-input', label: 'Needs input' }, { value: 'inactive', label: 'Ready' }] as const;
  const [provider, setProvider] = useState('all');
  const [groupByDirectory, setGroupByDirectory] = useState(false);
  const [search, setSearch] = useState('');
  return <section className="flex h-full min-h-0 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
          <h1 className="min-w-0 truncate text-xs font-medium uppercase tracking-wider">Sessions</h1>
          <div className="flex items-center gap-1">
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Search sessions" title="Search sessions" className={search ? 'text-blue-400' : ''}><Search aria-hidden="true" /></Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={4} className="z-50 w-64 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
                  <input aria-label="Search sessions" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sessions…" className="h-8 w-full min-w-0 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Filter sessions" title="Filter sessions" className={provider !== 'all' || dateRange !== 'today' || activity !== 'all' || groupByDirectory ? 'text-blue-400' : ''}><ListFilter aria-hidden="true" /></Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={4} className="z-50 w-56 space-y-3 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
                  <div className="space-y-1.5">
                    <label htmlFor="session-status-filter" className="text-xs font-medium">Status</label>
                    <Select value={activity} onValueChange={(value) => {
                      const option = statusOptions.find((entry) => entry.value === value);
                      if (option) setActivity(option.value);
                    }}>
                      <SelectTrigger id="session-status-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>{statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="session-date-filter" className="text-xs font-medium">Date</label>
                    <Select value={dateRange} onValueChange={setDateRange}>
                      <SelectTrigger id="session-date-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>{dateOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="session-provider-filter" className="text-xs font-medium">Provider</label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="session-provider-filter"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All providers</SelectItem>
                        {providers.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input type="checkbox" checked={groupByDirectory} onChange={(event) => setGroupByDirectory(event.target.checked)} />
                    Group by working directory
                  </label>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Refresh sessions" title="Refresh sessions" onClick={() => { void revalidate(); }} disabled={refreshState !== 'idle' || pending}><RefreshCw className={refreshState === 'idle' ? '' : 'animate-spin'} aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="New session" title="New session" onClick={() => onCreate()}><Plus aria-hidden="true" /></Button>
          </div>
        </div>
        {refreshError && <p role="alert" className="px-3 text-xs text-destructive">{refreshError}</p>}
        {discoveryErrors.map((issue) => <p key={issue.provider} role="alert" className="px-3 pb-3 text-xs text-destructive">{providers.find((provider) => provider.id === issue.provider)?.name ?? issue.provider}: {issue.error}</p>)}
        <div className="min-h-0 flex-1 overflow-auto"><SessionList {...listProps} activity={activity} onActivityChange={setActivity} search={search} provider={provider} dateRange={dateRange} groupByDirectory={groupByDirectory} /></div>
</section>;
}
