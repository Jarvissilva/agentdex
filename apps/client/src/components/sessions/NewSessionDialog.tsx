import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetcher } from 'react-router';
import type { Provider } from '@agentdex/shared';
import type { sessionsAction } from '@/pages/Sessions';
import { Button } from '@/components/ui/shadcn/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';

interface Props {
  providers: Provider[];
  defaultProviderId: string;
  defaultWorkingDirectory: string;
  directories: string[];
  onClose: () => void;
  onCreated: (id: string) => void;
}

export default function NewSessionDialog({ providers, defaultProviderId, defaultWorkingDirectory, directories, onClose, onCreated }: Props) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const attachDialog = useCallback((element: HTMLDialogElement | null) => {
    setDialog(element);
    if (element && !element.open) element.showModal();
  }, []);
  const fetcher = useFetcher<typeof sessionsAction>();
  const [workingDirectory, setWorkingDirectory] = useState(defaultWorkingDirectory);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const picker = useRef<AbortController | null>(null);
  const pending = fetcher.state !== 'idle' || picking;
  useEffect(() => () => picker.current?.abort(), []);

  async function browse() {
    if (picker.current) return;
    const controller = new AbortController();
    picker.current = controller;
    setPicking(true);
    setPickerError('');
    try {
      const result = await api<{ directory: string | null }>('/sessions/pick-directory', {
        method: 'POST', body: JSON.stringify({ workingDirectory }), signal: controller.signal,
      });
      if (!controller.signal.aborted && result.directory !== null) setWorkingDirectory(result.directory);
    } catch (error) {
      if (!controller.signal.aborted) setPickerError(error instanceof Error ? error.message : 'Unable to open the folder picker. Enter a directory path.');
    } finally {
      picker.current = null;
      if (!controller.signal.aborted) setPicking(false);
    }
  }

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.sessionId) onCreated(fetcher.data.sessionId);
  }, [fetcher.state, fetcher.data, onCreated]);

  return (
    <dialog ref={attachDialog} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }} aria-labelledby="new-session-title" className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-xl border border-border bg-background p-6 text-foreground backdrop:bg-black/60">
      <fetcher.Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value="launch" />
        <div>
          <h2 id="new-session-title" className="font-semibold">New session</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose a provider and working directory to open a terminal tab.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="new-session-provider" className="block text-sm font-medium">Provider</label>
          <Select name="provider" required disabled={pending} defaultValue={defaultProviderId}>
            <SelectTrigger id="new-session-provider" className="h-10 px-3 text-sm"><SelectValue placeholder="Select a provider" /></SelectTrigger>
            <SelectContent container={dialog}>
              {providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label htmlFor="new-session-directory" className="block text-sm font-medium">Working directory</label>
          <div className="flex min-w-0 items-center gap-2">
            <input id="new-session-directory" name="workingDirectory" list="session-directories" value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder="/absolute/path/to/project" required disabled={pending} spellCheck={false} autoComplete="off" aria-describedby="new-session-directory-hint" className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <Button type="button" variant="outline" className="h-10 shrink-0" disabled={pending} aria-label="Browse for working directory" onClick={() => { void browse(); }}><FolderOpen aria-hidden="true" />{picking ? 'Choosing…' : 'Browse'}</Button>
          </div>
          {pickerError && <p role="alert" className="text-sm text-destructive">{pickerError}</p>}
          <datalist id="session-directories">{directories.map((directory) => <option key={directory} value={directory} />)}</datalist>
          <p id="new-session-directory-hint" className="text-xs text-muted-foreground">Choose a recent directory or enter an absolute path. ~/path is supported.</p>
        </div>
        {fetcher.data?.error && <p role="alert" className="text-sm text-destructive">{fetcher.data.error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending || !providers.length}>{fetcher.state !== 'idle' ? 'Launching…' : 'Launch session'}</Button>
        </div>
      </fetcher.Form>
    </dialog>
  );
}
