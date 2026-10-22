import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { GUIDES, guideMetadata } from '@/lib/guides';
import { renderSections } from '@/lib/sections';
import { TOOLS } from '@/lib/tools';

const example = renderSections([
  { name: 'Role', content: 'You are an editor for a busy product team.' },
  { name: 'Context', content: 'The notes below are from our weekly planning call:\n{{notes}}' },
  { name: 'Task', content: 'Summarize the decisions and the open questions.' },
  { name: 'Format', content: 'Two headings, Decisions and Open questions, with at most five bullets each.' },
  { name: 'Constraints', content: 'Use only what the notes say. If something is unclear, list it under Open questions.' },
]);

export function generateMetadata() {
  return guideMetadata(GUIDES.goodPrompt);
}

export default function GoodPromptPage() {
  return (
    <GuideArticle guide={GUIDES.goodPrompt}>
      <p>
        A good prompt tells the model what a good answer looks like before it starts. Most weak
        prompts are not wrong, just underspecified: they leave the model to guess who the answer is
        for, how long it should be, and what shape it should take. The model then fills the gaps
        with something generic.
      </p>

      <h2>The six parts most prompts need</h2>
      <ol>
        <li><strong>Role</strong>: who the model should be, or who it writes for. &quot;You are a patient tutor&quot; or &quot;Write for busy managers&quot;.</li>
        <li><strong>Context</strong>: the material and background it cannot know: your notes, your product, your audience.</li>
        <li><strong>Task</strong>: one clear instruction with a verb. Summarize, rewrite, compare, draft, list.</li>
        <li><strong>Format</strong>: the shape of the answer. Headings, a table, bullets, JSON with given keys.</li>
        <li><strong>Constraints</strong>: length, tone, what to avoid, and what to do when information is missing.</li>
        <li><strong>Examples</strong>: one short sample of the output you want. It often does more than another paragraph of instructions.</li>
      </ol>
      <p>A quick question does not need all six. A prompt you reuse every week usually does.</p>

      <h2>A complete example</h2>
      <p>Here the five parts are separate sections, and the notes that change each week are a variable:</p>
      <pre><code>{example}</code></pre>
      <p>
        Compare it with &quot;Summarize these notes&quot;: the reader, the length, the structure and
        the rule for unclear points are now stated rather than guessed.
      </p>

      <h2>Make it reusable</h2>
      <p>
        Put the parts that change in <code>{'{{double_braces}}'}</code> and keep the rest fixed.
        Read <Link href={GUIDES.variables.path}>how to use variables in AI prompt templates</Link>, or
        try the <Link href={TOOLS.filler.path}>template filler</Link> to fill one in.
      </p>

      <h2>Test it, then change one thing at a time</h2>
      <ul>
        <li>Run it on two or three real inputs, including an awkward one: empty notes, a very long document, a mixed language.</li>
        <li>When an answer misses, change one instruction and run the same inputs again.</li>
        <li>Keep the earlier version so you can compare. The <Link href={TOOLS.diff.path}>prompt diff</Link> shows exactly what changed.</li>
      </ul>
      <p>
        Paste your own prompt into the <Link href={TOOLS.linter.path}>prompt checker</Link> to see which
        of these parts it is missing.
      </p>
    </GuideArticle>
  );
}
