import Link from 'next/link';
import ToolPage from '@/components/public/ToolPage';
import PromptRefiner from '@/features/tools/PromptRefiner';
import { GUIDES } from '@/lib/guides';
import { TOOLS, toolMetadata } from '@/lib/tools';

export function generateMetadata() {
  return toolMetadata(TOOLS.refiner);
}

const FAQ = [
  { question: 'What does the refiner change?', answer: 'It makes the prompt clearer and more specific: who the answer is for, what shape and length it should have, and what to do with missing information. It keeps your {{variables}} and your intent, and shows every added and removed word so you can judge the change.' },
  { question: 'Should I answer the questions?', answer: 'Answers make the result fit your situation instead of a generic guess. Answer the ones that matter and leave the rest blank, or skip them: Improve now and Refine with my answers both work with blank answers.' },
  { question: 'Is it really free?', answer: 'Yes, within limits. Each request, for questions or for a refined prompt, counts toward a per-minute and a daily limit for each visitor, and the site has its own daily limit and may set a monthly budget. Sign in and connect your own AI provider to refine without these limits.' },
  { question: 'What happens to my prompt?', answer: 'It is sent to this site\'s AI provider to produce the refinement and is not stored by this site; the AI provider\'s own data policy applies. Your IP address is used only briefly, in memory, to apply the limits. Avoid pasting personal or confidential information into any AI tool.' },
];

export default function PromptRefinerPage() {
  return (
    <ToolPage tool={TOOLS.refiner} faq={FAQ} widget={<PromptRefiner />} local={false}>
      <h2>From a rough prompt to a clear one</h2>
      <p>
        Paste a prompt you use, or one that gives vague answers. Choose <strong>Improve now</strong> for
        a tighter version straight away, or <strong>Ask me questions first</strong> to get a few short
        questions about what you need. The refined prompt is shown word by word against your original.
      </p>
      <h2>Example</h2>
      <p>
        &quot;Write a summary of <code>{'{{notes}}'}</code> for my team.&quot; might come back with short
        labelled lines that name the readers, the shape and length of the answer, and what to do when the
        notes leave something out: say so rather than guess.
      </p>
      <p>
        Before refining, run the free <Link href={TOOLS.linter.path}>prompt checker</Link> to see what is
        missing, and read <Link href={GUIDES.goodPrompt.path}>what makes a good AI prompt</Link>.
      </p>
    </ToolPage>
  );
}
