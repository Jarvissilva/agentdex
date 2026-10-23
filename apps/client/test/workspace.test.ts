import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LibraryItem } from '@agentdex/shared';
import { adjacentTab, findEditorTab, initialPanel, legacyWorkspaceLocation, panels, type EditorTab, type WorkspaceTab } from '../src/lib/workspace.ts';

const item: LibraryItem = { id: 'saved', name: 'Saved skill', nativeName: 'saved', installations: [] };
const saved: EditorTab = { type: 'editor', key: 'stable-key', kind: 'skills', item, dirty: true };
const draft: EditorTab = { type: 'editor', key: 'draft-key', kind: 'skills', item: 'new', dirty: true };

test('every legacy URL selects its panel while preserving new-session parameters', () => {
  for (const panel of panels) {
    const target = legacyWorkspaceLocation(panel, `http://localhost/${panel}?new=1&panel=invalid`);
    const url = new URL(target, 'http://localhost');
    assert.equal(url.pathname, '/');
    assert.equal(url.searchParams.get('new'), '1');
    assert.equal(initialPanel(url.search), panel);
  }
  assert.equal(legacyWorkspaceLocation('sessions', 'http://localhost/sessions'), '/');
});

test('reload without panel selection defaults to Sessions and rejects unknown panels', () => {
  assert.equal(initialPanel(''), 'sessions');
  assert.equal(initialPanel('?panel=invalid'), 'sessions');
});

test('reopening a refreshed library item focuses its existing dirty editor', () => {
  const tabs = [saved, draft];
  assert.equal(findEditorTab(tabs, 'skills', { ...item, name: 'Refreshed name' }), saved);
  assert.equal(saved.dirty, true);
  assert.equal(saved.item, item);
  assert.equal(findEditorTab(tabs, 'agents', item), undefined);
});

test('there is one new draft per kind and saved drafts leave room for a new one', () => {
  assert.equal(findEditorTab([draft], 'skills', 'new'), draft);
  assert.equal(findEditorTab([draft], 'agents', 'new'), undefined);
  const created = { ...draft, item, dirty: false };
  assert.equal(findEditorTab([created], 'skills', 'new'), undefined);
  assert.equal(findEditorTab([created], 'skills', item), created);
  assert.equal(created.key, draft.key);
});

test('closing a mixed terminal/editor tab selects the next then previous neighbor', () => {
  const terminal: WorkspaceTab = { type: 'terminal', key: 'terminal' };
  const tabs = [terminal, saved, draft];
  assert.equal(adjacentTab(tabs, terminal.key), saved.key);
  assert.equal(adjacentTab(tabs, saved.key), draft.key);
  assert.equal(adjacentTab(tabs, draft.key), saved.key);
  assert.equal(adjacentTab([saved], saved.key), '');
  assert.equal(adjacentTab([], 'missing'), '');
});
