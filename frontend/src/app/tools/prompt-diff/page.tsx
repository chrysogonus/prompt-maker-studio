import Link from 'next/link';
import ToolPage from '@/components/public/ToolPage';
import PromptDiff from '@/features/tools/PromptDiff';
import { TOOLS, toolMetadata } from '@/lib/tools';

export function generateMetadata() {
  return toolMetadata(TOOLS.diff);
}

const FAQ = [
  { question: 'How are the prompts compared?', answer: 'Word by word. Spaces and {{variables}} count as their own pieces, so a changed word next to a variable does not mark the variable as changed too.' },
  { question: 'Can I compare long prompts?', answer: 'Yes. Very long pairs are shown as fully removed and fully added text rather than word by word, so your browser stays responsive.' },
  { question: 'Is my text sent anywhere?', answer: 'No. The comparison runs in your browser.' },
  { question: 'Can I keep versions automatically?', answer: 'Yes. In your library every save keeps the previous version, so you can compare any version with the current one and restore it.' },
];

export default function PromptDiffPage() {
  return (
    <ToolPage tool={TOOLS.diff} faq={FAQ} widget={<PromptDiff />}>
      <h2>See what changed between two prompts</h2>
      <p>
        When a prompt starts giving better or worse answers, the reason is often one changed
        sentence. Paste the earlier version in Before and the newer one in After to see the
        added and removed words.
      </p>
      <h2>Example</h2>
      <p>
        The example compares a vague request with a specific one. The diff shows the added limit
        (&quot;at most five bullets&quot;) and the new ordering instruction, while{' '}
        <code>{'{{team}}'}</code> stays unchanged.
      </p>
      <p>
        Check the newer version with the <Link href={TOOLS.linter.path}>prompt checker</Link>, or
        estimate its size with the <Link href={TOOLS.tokens.path}>token counter</Link>.
      </p>
    </ToolPage>
  );
}
