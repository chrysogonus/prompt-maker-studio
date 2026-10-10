/**
 * Starting points for a new prompt. Sections start empty with a hint in the
 * placeholder rather than filler text, so nothing generic ends up in a saved
 * prompt by accident.
 */

export interface StarterSection {
  name: string;
  content: string;
  hint: string;
}

export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  sections: StarterSection[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'role-task-format',
    label: 'Role, task, format',
    description: 'The general shape most prompts fit.',
    sections: [
      { name: 'Role', content: '', hint: 'Who should the model be? For example: a patient tutor' },
      {
        name: 'Task',
        content: '',
        hint: 'What should it do? Put the parts that change each time in {{double_braces}}',
      },
      { name: 'Format', content: '', hint: 'How should the answer look? Length, structure, tone' },
    ],
  },
  {
    id: 'rewrite',
    label: 'Rewrite my text',
    description: 'Edit a draft without losing your voice.',
    sections: [
      { name: 'Text', content: '{{text}}', hint: '' },
      { name: 'Goal', content: '', hint: 'What should the rewrite achieve? For example: shorter' },
      { name: 'Keep', content: '', hint: 'What must not change? Names, facts, phrases' },
      { name: 'Tone', content: '', hint: 'For example: friendly, formal, direct' },
    ],
  },
  {
    id: 'summarise',
    label: 'Summarise something',
    description: 'Long text in, the parts you need out.',
    sections: [
      { name: 'Source', content: '{{source}}', hint: '' },
      { name: 'Audience', content: '', hint: 'Who reads the summary, and what do they care about?' },
      { name: 'Format', content: '', hint: 'For example: five bullets, then open questions' },
    ],
  },
  {
    id: 'persona',
    label: 'Persona',
    description: 'A consistent character, voice and set of limits.',
    sections: [
      { name: 'Persona', content: '', hint: 'Name, background, how they think' },
      { name: 'Voice', content: '', hint: 'How they speak. Words they would and would not use' },
      { name: 'Task', content: '', hint: 'What they help with in this conversation' },
    ],
  },
];
