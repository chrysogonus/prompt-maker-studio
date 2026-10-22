import Link from 'next/link';
import ToolPage from '@/components/public/ToolPage';
import PromptLinter from '@/features/tools/PromptLinter';
import { GUIDES } from '@/lib/guides';
import { TOOLS, toolMetadata } from '@/lib/tools';

export function generateMetadata() {
  return toolMetadata(TOOLS.linter);
}

const FAQ = [
  { question: 'Does every prompt need all of these parts?', answer: 'No. The checks look for parts that usually improve an answer: who it is for, what shape it should take, how long it should be and an example. A quick question does not need them all, so suggestions are not errors.' },
  { question: 'What is the difference between a problem and a suggestion?', answer: 'Problems break the prompt: an invalid {{variable}} name, two variables that differ only in capitalization, or tags that are opened but not closed. Suggestions point to parts that are missing.' },
  { question: 'How does the checker decide?', answer: 'With simple word patterns, in your browser. It looks for phrases such as "you are", "bullets", "under 100 words" or "for example". It does not understand meaning, so read each finding before changing your prompt.' },
  { question: 'Is my prompt sent anywhere?', answer: 'No. The checks run in your browser. Only "Save to my library" sends the prompt, and only after you sign in.' },
];

export default function PromptLinterPage() {
  return (
    <ToolPage tool={TOOLS.linter} faq={FAQ} widget={<PromptLinter />}>
      <h2>What the checker looks for</h2>
      <ul>
        <li><strong>A role or audience</strong>, such as &quot;You are a patient tutor&quot; or &quot;for busy managers&quot;.</li>
        <li><strong>An output format</strong>, such as a table, bullets, headings or JSON.</li>
        <li><strong>A length or limit</strong>, such as &quot;under 150 words&quot; or &quot;at most five bullets&quot;.</li>
        <li><strong>An example</strong> of the answer or input you have in mind.</li>
        <li><strong>Broken syntax</strong>: invalid <code>{'{{variable}}'}</code> names, variables that differ only in capitalization, and unclosed tags.</li>
        <li><strong>Structure</strong> in long prompts, such as labelled sections or tags.</li>
      </ul>
      <h2>Example</h2>
      <p>
        &quot;Summarize this article about <code>{'{{topic}}'}</code>.&quot; gets four suggestions. A
        stronger version: &quot;You are an editor for a busy product team. Summarize this article about{' '}
        <code>{'{{topic}}'}</code> in at most five bullets, decisions first. For example: &apos;Decision:
        ship the beta in May.&apos;&quot;
      </p>
      <p>
        Read <Link href={GUIDES.reusable.path}>how to create reusable AI prompts</Link> for the sections
        most prompts fit, and compare your before and after with the{' '}
        <Link href={TOOLS.diff.path}>prompt diff</Link>.
      </p>
    </ToolPage>
  );
}
