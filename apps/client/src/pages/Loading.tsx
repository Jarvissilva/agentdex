import { Command, LoaderCircle } from 'lucide-react';

export default function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-12">
      <div role="status" className="flex flex-col items-center text-center">
        <div aria-hidden="true" className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-border bg-sidebar shadow-sm">
          <Command className="size-6 text-foreground" strokeWidth={1.5} />
        </div>
        <h1 className="text-lg font-medium tracking-tight text-foreground">AgentDex</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
          Loading workspace…
        </p>
      </div>
    </main>
  );
}
