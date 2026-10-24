import Link from 'next/link';
import ToolPage from '@/components/public/ToolPage';
import TemplateFiller from '@/features/tools/TemplateFiller';
import { GUIDES } from '@/lib/guides';
import { TOOLS, toolMetadata } from '@/lib/tools';

export function generateMetadata() {
  return toolMetadata(TOOLS.filler);
}

const EXAMPLE = 'Write a short, friendly reply to {{customer_name}} about their {{issue}}. Promise an update within {{hours}} hours.';

const FAQ = [
  { question: 'What counts as a variable?', answer: 'Any name in double braces, such as {{customer_name}}. Names use letters, numbers, underscores or hyphens and start with a letter or underscore. The same name used twice gets one field.' },
  { question: 'What happens to a variable I leave empty?', answer: 'It stays in the copied text as {{name}}, so you can see what is missing or fill it in later in your AI assistant.' },
  { question: 'Is my prompt sent anywhere?', answer: 'No. Filling in and copying happen in your browser. Only "Save to my library" sends the template, and only after you sign in.' },
  { question: 'Which AI assistants does this work with?', answer: 'All of them. The result is plain text you paste into ChatGPT, Claude, Gemini or any other assistant.' },
];

export default function TemplateFillerPage() {
  return (
    <ToolPage tool={TOOLS.filler} faq={FAQ} widget={<TemplateFiller initialText={EXAMPLE} />}>
      <h2>Reuse a prompt without rewriting it</h2>
      <p>
        Most prompts you use more than once have a fixed part, the instructions, and a part that
        changes each time: a name, a topic, a document. Write the changing parts as{' '}
        <code>{'{{variables}}'}</code>, and this tool turns each one into a field. Fill them in,
        check the result and copy it.
      </p>
      <h2>Example</h2>
      <p>The template above asks for three details:</p>
      <pre><code>{EXAMPLE}</code></pre>
      <p>
        Enter <strong>Dana</strong>, <strong>late delivery</strong> and <strong>24</strong>, and the
        copied prompt reads: &quot;Write a short, friendly reply to Dana about their late delivery.
        Promise an update within 24 hours.&quot;
      </p>
      <p>
        To learn more about naming variables and adding hints, read{' '}
        <Link href={GUIDES.variables.path}>how to use variables in AI prompt templates</Link>. To check
        a template for missing parts first, try the <Link href={TOOLS.linter.path}>prompt checker</Link>.
      </p>
    </ToolPage>
  );
}
