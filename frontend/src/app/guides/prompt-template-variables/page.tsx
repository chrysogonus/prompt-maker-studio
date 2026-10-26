import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { GUIDES, guideMetadata } from '@/lib/guides';
import { fillVariables, renderSections } from '@/lib/sections';

const template = renderSections([
  { name: 'Task', content: 'Write a weekly update for {{team}} using these notes:\n{{notes}}' },
  { name: 'Format', content: 'Use three headings: Progress, Blockers, Next steps.' },
]);
const exampleInputs = {
  team: 'Customer support',
  notes: 'Updated the help centre. Waiting for approval of the refund policy. Next: train the team.',
};

export function generateMetadata() {
  return guideMetadata(GUIDES.variables);
}

export default function TemplateVariablesPage() {
  return (
    <GuideArticle guide={GUIDES.variables}>
      <p>
        A prompt variable is a placeholder for a detail that changes each time you use a prompt.
        Write it in double braces, such as <code>{'{{team}}'}</code>. The editor detects it and gives
        you a field to fill in, so you can reuse the instructions without editing them each time.
      </p>

      <h2>Turn changing details into variables</h2>
      <p>Start with an ordinary request:</p>
      <pre><code>
        Write a weekly update for Customer support using these notes: Updated the help centre.
        Waiting for approval of the refund policy. Next: train the team.
      </code></pre>
      <p>
        The team and notes will change. Replace those details with <code>{'{{team}}'}</code> and{' '}
        <code>{'{{notes}}'}</code> in the section text. Follow the{' '}
        <Link href={GUIDES.reusable.path}>weekly update walkthrough</Link> to create the Task and
        Format sections. The resulting template preview looks like this:
      </p>
      <pre><code>{template}</code></pre>
      <p>
        The surrounding tags come from the section names automatically. Variable names can contain
        letters, numbers, underscores, and hyphens, and must start with a letter or underscore.
        Use <code>{'{{project_name}}'}</code> rather than <code>{'{{project name}}'}</code>.
        Reusing the same name in several sections gives them one shared input.
      </p>

      <h2>Add hints and optional settings</h2>
      <ol>
        <li>
          Find <strong>Variables</strong> below the sections. Variables appear here automatically
          when you type their placeholders in the section text.
        </li>
        <li>
          Add a hint such as &quot;Who will receive this update?&quot; for <code>team</code>.
          Hints appear inside the empty input fields when filling the prompt.
        </li>
        <li>
          If a value must be supplied before a complete copy, open <strong>Options for team</strong>{' '}
          and select <strong>Required team</strong>. Variables are optional unless you mark them required.
        </li>
        <li>
          In the same options, optionally fill in <strong>Example input</strong>. Choose <strong>Save</strong> to keep hints, requirements,
          and examples with the template. Examples are not inserted automatically.
        </li>
      </ol>

      <h2>Fill in the template and copy the result</h2>
      <ol>
        <li>
          In <strong>Preview</strong>, select <strong>Filled</strong>. On a phone, select{' '}
          <strong>Fill and copy</strong> to reach the preview. If you hid the desktop preview,
          choose <strong>Preview</strong> to show it again.
        </li>
        <li>
          Enter <strong>{exampleInputs.team}</strong> for <code>team</code> and this text for{' '}
          <code>notes</code>: <strong>{exampleInputs.notes}</strong>
        </li>
        <li>
          If you saved example inputs, <strong>Load example inputs</strong> fills those values
          only when you choose it. It replaces the current values for variables with saved examples.
        </li>
        <li>
          Check the preview, choose <strong>Copy filled prompt</strong>, and paste the result into
          your assistant. Filling in and copying need no AI provider.
        </li>
      </ol>
      <p>With the sample inputs above, the copied prompt is:</p>
      <pre><code>{fillVariables(template, exampleInputs)}</code></pre>
      <p>
        This is the text you send to the assistant, rather than an AI-generated update. Generating
        the update happens in the assistant you paste into, or through the optional{' '}
        <strong>Try once</strong> action inside <strong>Test with AI</strong>, using your
        connected provider.
      </p>

      <h2>Choose the right copy action</h2>
      <ul>
        <li><strong>Copy template</strong> keeps the placeholders for reuse or editing elsewhere.</li>
        <li>
          <strong>Copy filled prompt</strong> substitutes the values you entered. Missing optional
          values stay as placeholders, with a warning. Missing required values disable this action.
        </li>
        <li>
          <strong>Copy with placeholders</strong> explicitly allows an incomplete copy, including
          missing required values. Use it when you plan to finish the inputs elsewhere.
        </li>
        <li><strong>Copy prompt</strong> is the label when the prompt has no variables.</li>
      </ul>
      <p>
        Save keeps the template and its variable settings. It does not save the current filled
        values as example inputs; enter examples in Variables and save them explicitly if needed.
      </p>
    </GuideArticle>
  );
}
