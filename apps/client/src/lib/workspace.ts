import type { LibraryItem, LibraryKind } from '@agentdex/shared';

export const panels = ['sessions', 'skills', 'agents', 'mcps', 'settings'] as const;
export type WorkspacePanel = typeof panels[number];
export type EditorTab = { type: 'editor'; key: string; kind: LibraryKind; item: LibraryItem | 'new'; dirty: boolean };
export type WorkspaceTab = EditorTab | { type: 'terminal'; key: string };

export function initialPanel(search: string): WorkspacePanel {
  const value = new URLSearchParams(search).get('panel');
  return panels.find(panel => panel === value) ?? 'sessions';
}

export function legacyWorkspaceLocation(panel: WorkspacePanel, url: string) {
  const query = new URL(url).searchParams;
  query.delete('panel');
  if (panel !== 'sessions') query.set('panel', panel);
  const search = query.toString();
  return search ? `/?${search}` : '/';
}

export function findEditorTab(tabs: EditorTab[], kind: LibraryKind, item: LibraryItem | 'new') {
  return tabs.find(tab => tab.kind === kind && (item === 'new' ? tab.item === 'new' : tab.item !== 'new' && tab.item.id === item.id));
}

export function adjacentTab(tabs: WorkspaceTab[], key: string) {
  const index = tabs.findIndex(tab => tab.key === key);
  return index < 0 ? '' : tabs[index + 1]?.key ?? tabs[index - 1]?.key ?? '';
}
