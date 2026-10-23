import type { Dispatch, SetStateAction } from 'react';

interface Props { content: string; setContent: Dispatch<SetStateAction<string>>; fieldClass: string }
export default function SkillEditor({ content, setContent, fieldClass }: Props) { return <label className="block space-y-1"><span>SKILL.md</span><textarea rows={12} required value={content} onChange={e => setContent(e.target.value)} className={`${fieldClass} font-mono`} /></label>; }
