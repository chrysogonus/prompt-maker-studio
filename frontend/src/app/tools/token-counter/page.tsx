import Link from 'next/link';
import ToolPage from '@/components/public/ToolPage';
import TokenCounter from '@/features/tools/TokenCounter';
import { TOOLS, toolMetadata } from '@/lib/tools';

export function generateMetadata() {
  return toolMetadata(TOOLS.tokens);
}

const FAQ = [
  { question: 'How accurate is the estimate?', answer: 'It assumes about four characters per token, a common average for English text. Real counts depend on each model\'s tokenizer and can differ, especially for code, numbers and other languages. Treat it as a guide for size and cost, not a bill.' },
  { question: 'Which prices are used?', answer: 'Current list prices for the models this app supports, per million input tokens. Output tokens, caching and discounts are not included.' },
  { question: 'Why does token count matter?', answer: 'Models have a context limit, and you pay per token. A prompt you run many times, or one that includes long documents, adds up quickly.' },
  { question: 'Is my prompt sent anywhere?', answer: 'No. Counting happens in your browser. The page only downloads the price list.' },
];

export default function TokenCounterPage() {
  return (
    <ToolPage tool={TOOLS.tokens} faq={FAQ} widget={<TokenCounter />}>
      <h2>Estimate size and cost before you run a prompt</h2>
      <p>
        Language models read text as tokens, pieces of words. Paste a prompt to see its characters,
        words and an estimated token count, and what it would cost as input on current models, once
        and over a thousand runs.
      </p>
      <h2>Example</h2>
      <p>
        A 2,000-character prompt is about 500 tokens. At $2 per million input tokens, that is $0.001
        per run, or $1 for a thousand runs, before the cost of the answer.
      </p>
      <p>
        To make a long prompt shorter without losing meaning, compare drafts with the{' '}
        <Link href={TOOLS.diff.path}>prompt diff</Link>.
      </p>
    </ToolPage>
  );
}
