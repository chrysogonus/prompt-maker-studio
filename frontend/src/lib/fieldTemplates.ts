/**
 * Curated starting points for the field editor. Static and client-side —
 * no backend involvement, just a shortcut past the blank-editor cold start.
 */

import { PromptField } from '@/types/prompt';

export interface FieldTemplate {
  id: string;
  label: string;
  description: string;
  fields: PromptField[];
}

export const FIELD_TEMPLATES: FieldTemplate[] = [
  {
    id: 'role-task-context',
    label: 'Role-Task-Context',
    description: 'A general-purpose structure: who the model is, what to do, and background info.',
    fields: [
      { name: 'role', content: 'You are an expert assistant with deep knowledge of...' },
      { name: 'task', content: 'Your task is to...' },
      { name: 'context', content: 'Here is the relevant background information...' },
    ],
  },
  {
    id: 'chain-of-thought',
    label: 'Chain-of-Thought',
    description: 'Encourages step-by-step reasoning before producing a final answer.',
    fields: [
      { name: 'task', content: 'Solve the following problem...' },
      { name: 'reasoning_instructions', content: 'Think through this step by step before giving your final answer.' },
      { name: 'output_format', content: 'Show your reasoning, then state the final answer on its own line.' },
    ],
  },
  {
    id: 'persona',
    label: 'Persona',
    description: 'Grounds the model in a specific character, tone, and voice.',
    fields: [
      { name: 'persona', content: 'You are... (name, background, personality traits)' },
      { name: 'tone', content: 'Speak in a tone that is...' },
      { name: 'task', content: 'Given this persona, your task is to...' },
    ],
  },
];
