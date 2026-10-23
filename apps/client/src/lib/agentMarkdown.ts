import { parse, stringify } from 'yaml';
import type { AgentDefinition } from '@agentdex/shared';

export function parseAgentMarkdown(content: string): AgentDefinition {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const front: unknown = match && parse(match[1]!);
  if (!front || typeof front !== 'object' || Array.isArray(front)) throw Error('Markdown requires name and description frontmatter.');
  const fields = front as Record<string, unknown>;
  const unsupported = Object.keys(fields).filter(key => !['name', 'description'].includes(key));
  if (unsupported.length) throw Error(`Unsupported agent frontmatter fields: ${unsupported.join(', ')}.`);
  if (typeof fields.name !== 'string' || typeof fields.description !== 'string') throw Error('Name and description must be strings.');
  return { name: fields.name, description: fields.description, instructions: content.slice(match![0].length).replace(/^\r?\n/, '').replace(/\r?\n$/, '') };
}
export function agentMarkdown(agent: AgentDefinition): string {
  return `---\n${stringify({ name: agent.name, description: agent.description })}---\n\n${agent.instructions}\n`;
}
