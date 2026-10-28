import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { GUIDES, guideMetadata } from '@/lib/guides';
import { renderSections } from '@/lib/sections';
import { TOOLS } from '@/lib/tools';

const research = renderSections([
  { name: 'Role', content: 'You are a careful research assistant writing for {{audience}}.' },
  { name: 'Sources', content: 'Use only the sources below. Cite each claim with the source number in brackets, such as [2].\n{{sources}}' },
  { name: 'Task', content: 'Explain {{question}}. Separate what the sources agree on from where they disagree.' },
  { name: 'Format', content: 'At most 300 words: a two-sentence answer, then short sections with headings.' },
  { name: 'Constraints', content: 'If the sources do not answer part of the question, say so instead of guessing. Do not invent sources, numbers or quotes.' },
]);

export function generateMetadata() {
  return guideMetadata(GUIDES.researchWriting);
}

export default function ResearchWritingPromptsPage() {
  return (
    <GuideArticle guide={GUIDES.researchWriting}>
      <p>
        AI assistants are fluent, which makes them good at drafting and summarizing, and risky when
        accuracy matters: they can state invented facts in the same confident tone as real ones. A
        good research or writing prompt therefore says who the text is for, what it may rely on, and
        what to do when the material runs out.
      </p>

      <h2>For research and summaries</h2>
      <ul>
        <li><strong>Give the sources.</strong> Paste the articles, notes or data, and ask the model to use only them.</li>
        <li><strong>Ask for citations</strong> to your numbered sources, so every claim can be checked.</li>
        <li><strong>Say what to do with gaps</strong>: &quot;If the sources do not cover it, say so.&quot;</li>
        <li><strong>Separate agreement from disagreement</strong>, and facts from interpretation.</li>
        <li><strong>Check the result.</strong> Open the cited passages for anything you will repeat or publish.</li>
      </ul>
      <pre><code>{research}</code></pre>

      <h2>For writing</h2>
      <ul>
        <li><strong>Audience and purpose</strong>: who reads it and what they should do or know afterwards.</li>
        <li><strong>Tone</strong> with an example: &quot;plain and warm, like this paragraph: …&quot;, which works better than adjectives alone.</li>
        <li><strong>Structure and length</strong>: headings, a word limit, what goes first.</li>
        <li><strong>Your own material</strong>: key points, facts and quotes to use, and a rule against adding others.</li>
        <li><strong>Words to avoid</strong>, such as superlatives you cannot prove or jargon your readers do not know.</li>
      </ul>

      <h2>Keep what works</h2>
      <p>
        A template like the one above can be reused for every question by filling in its variables;
        try the <Link href={TOOLS.filler.path}>template filler</Link>. Before you rely on a prompt,
        run it through the <Link href={TOOLS.linter.path}>prompt checker</Link>, and read{' '}
        <Link href={GUIDES.goodPrompt.path}>what makes a good prompt</Link> for the general structure.
      </p>

      <h2>Further reading</h2>
      <p>
        Anthropic&apos;s guide to{' '}
        <a href="https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations">reducing
        hallucinations</a> recommends the same habits: let the model say it does not know, ground
        answers in direct quotes, and have it cite a source for each claim. It also notes that these
        techniques reduce invented facts but do not remove them, so check anything you publish.
      </p>
    </GuideArticle>
  );
}
