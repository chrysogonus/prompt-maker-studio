import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import styles from '@/components/guides/Guides.module.css';
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

      <h2>Variable syntax in other tools</h2>
      <p>
        Placeholders are a convention, not a standard, so check which form a tool expects before
        moving a template between them.
      </p>
      <div className={styles.tableWrap} role="region" aria-label="Variable syntax by tool" tabIndex={0}>
        <table>
          <thead>
            <tr><th scope="col">Where</th><th scope="col">Placeholder</th><th scope="col">Notes</th></tr>
          </thead>
          <tbody>
            <tr><td>This app</td><td><code>{'{{team}}'}</code></td><td>Letters, numbers, underscores and hyphens; no spaces.</td></tr>
            <tr>
              <td>Anthropic&apos;s prompting guide</td><td><code>{'{{ANNUAL_REPORT}}'}</code></td>
              <td>
                Its <a href="https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices">examples</a>{' '}
                put each input in its own XML tag around a double-brace placeholder.
              </td>
            </tr>
            <tr>
              <td>Google Vertex AI Studio</td><td><code>{'{animal_name}'}</code></td>
              <td>
                <a href="https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/prompt-templates">Prompt templates</a>{' '}
                use single braces; names cannot contain spaces.
              </td>
            </tr>
            <tr>
              <td>LangChain and LangSmith</td><td><code>{'{name}'}</code> or <code>{'{{name}}'}</code></td>
              <td>
                <a href="https://docs.langchain.com/langsmith/prompt-template-format">f-string or mustache</a>{' '}
                format; mustache also supports loops and conditions.
              </td>
            </tr>
            <tr><td>ChatGPT, Claude or Gemini chats</td><td>None</td><td>The chat sees plain text, so fill in every value before you paste.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Pitfalls to avoid</h2>
      <ul>
        <li>
          <strong>Sending an unfilled placeholder.</strong> A model that receives{' '}
          <code>{'{{notes}}'}</code> may invent notes or write about the placeholder itself. Mark
          inputs the prompt cannot work without as required, so <strong>Copy filled prompt</strong>{' '}
          waits until they have a value.
        </li>
        <li>
          <strong>Pasted text that gives orders.</strong> An email or web page you paste into{' '}
          <code>{'{{notes}}'}</code> can contain sentences that read like instructions. Keep such
          inputs in their own section, which becomes their own tag, and say in the Task that its
          contents are material to work with, not instructions to follow.
        </li>
        <li>
          <strong>One name for two meanings.</strong> Every use of a name shares one input, so{' '}
          <code>{'{{date}}'}</code> cannot be both a deadline and a meeting day. Use{' '}
          <code>{'{{due_date}}'}</code> and <code>{'{{meeting_date}}'}</code>.
        </li>
        <li>
          <strong>Vague names.</strong> <code>{'{{text}}'}</code> says little when you fill the
          prompt in weeks later; <code>{'{{customer_email}}'}</code> explains itself, and a hint can
          say the rest.
        </li>
      </ul>
    </GuideArticle>
  );
}
