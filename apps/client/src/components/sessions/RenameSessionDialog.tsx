import { useState, type FormEvent } from 'react';
import type { ProviderSession } from '@agentdex/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/shadcn/button';

interface Props { refresh: () => Promise<void>; session: ProviderSession; onClose: () => void }

export default function RenameSessionDialog({ session, onClose, refresh: revalidate }: Props) {
  const [title, setTitle] = useState(session.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api(`/sessions/history/${encodeURIComponent(session.provider)}/${encodeURIComponent(session.id)}`, {
        method: 'PATCH', body: JSON.stringify({ title: title.trim() }),
      });
      await revalidate();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Unable to rename session. Retry.');
    } finally { setSaving(false); }
  }

  return (
    <dialog ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} aria-labelledby="rename-session-title" className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-xl border border-border bg-background p-6 text-foreground backdrop:bg-black/60">
      <form onSubmit={(event) => { void save(event); }} className="space-y-4">
        <h3 id="rename-session-title" className="font-semibold">Rename session</h3>
        <div className="space-y-2">
          <label htmlFor="session-title" className="text-sm">Session title</label>
          <input id="session-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} disabled={saving} autoFocus onFocus={(event) => event.target.select()} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </dialog>
  );
}
