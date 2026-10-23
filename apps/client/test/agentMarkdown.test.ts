import test from 'node:test';
import assert from 'node:assert/strict';
import { agentMarkdown, parseAgentMarkdown } from '../src/lib/agentMarkdown.ts';

test('form and Markdown round trip quoted and multiline content', () => {
  const agent = { name: 'my-specialist', description: 'Text: "quotes"\nAnother line', instructions: '# Instructions\nUse \\paths and 日本語.' };
  assert.deepEqual(parseAgentMarkdown(agentMarkdown(agent)), agent);
  const indented = { ...agent, instructions: '    preserve code indentation\n\n' };
  assert.deepEqual(parseAgentMarkdown(agentMarkdown(indented)), indented);
});
test('unsupported frontmatter never silently loses settings', () => {
  assert.throws(() => parseAgentMarkdown('---\nname: test\ndescription: Test\npermissions: []\n---\nInstructions'), /Unsupported.*permissions/);
  assert.throws(() => parseAgentMarkdown('invalid'));
});
