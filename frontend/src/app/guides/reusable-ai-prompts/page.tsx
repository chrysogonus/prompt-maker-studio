/* eslint-disable @next/next/no-img-element -- reuse the static screenshots shipped with the landing page */
import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { APP_NAME } from '@/lib/branding';
import { GUIDES, guideMetadata } from '@/lib/guides';

export function generateMetadata() {
  return guideMetadata(GUIDES.reusable);
}

export default function ReusablePromptsPage() {
  return (
    <GuideArticle guide={GUIDES.reusable}>
      <p>
        A reusable prompt keeps the instructions that work and gives the changing details a name.
        Instead of rewriting a weekly update request every Friday, keep its task and output format
        in your library, then fill in this week&apos;s team and notes.
      </p>

      <h2>Start with a prompt you already use</h2>
      <p>
        Pick one repeatable task: summarizing meeting notes, rewriting an email, or drafting a status
        update. Separate the instructions that stay the same from the information you replace each
        time. For example, the headings in a weekly update can stay fixed while the team and progress
        notes change.
      </p>

      <h2>Create a weekly update template</h2>
      <ol>
        <li>Open your library and choose <strong>New prompt</strong>.</li>
        <li>
          The new editor starts with a section named <strong>Task</strong>. Enter this in its text field:
          <pre><code>{'Write a weekly update for {{team}} using these notes:\n{{notes}}'}</code></pre>
        </li>
        <li>
          Choose <strong>Add section</strong>. Change its section name to <strong>Format</strong> and
          enter this text:
          <pre><code>Use three headings: Progress, Blockers, Next steps.</code></pre>
        </li>
        <li>
          Check the preview. {APP_NAME} adds the <code>{'<TASK>'}</code> and{' '}
          <code>{'<FORMAT>'}</code> tags automatically from your section names. Enter each section&apos;s
          content separately; you do not need to type its wrapping tags.
        </li>
        <li>
          Choose <strong>Save</strong>. Enter <strong>Weekly status update</strong> as the name and,
          optionally, <strong>Work</strong> as the folder. Choose <strong>Save prompt</strong> to keep it
          in your library.
        </li>
      </ol>
      <p>
        For another starting point, use <strong>Starter templates</strong> in a new prompt. These
        provide section structures such as <strong>Role, task, format</strong>. Choosing a starter
        replaces your current sections, so choose it before writing your own example.
      </p>
      <figure>
        <img src="/landing/editor.png" width={1440} height={900} loading="lazy"
          alt="Prompt editor with named sections on the left and a filled weekly update preview on the right." />
        <figcaption>
          The editor keeps section text beside the preview. This saved example uses additional
          Role and Context sections; your two-section template works the same way.
        </figcaption>
      </figure>

      <h2>Fill it in when you need it</h2>
      <p>
        Select <strong>Filled</strong> in the preview and enter values for <code>team</code> and{' '}
        <code>notes</code>. On a phone, select <strong>Fill and copy</strong> first. Choose{' '}
        <strong>Copy filled prompt</strong>, then paste it into ChatGPT, Claude, Gemini, or your
        preferred assistant. The <Link href={GUIDES.variables.path}>guide to template variables</Link>{' '}
        explains hints, required inputs, and example values.
      </p>

      <h2>Improve the template without losing the old version</h2>
      <p>
        When an instruction needs changing, edit the saved prompt and choose <strong>Save</strong>.
        Open <strong>History</strong> and select an earlier version to compare it with the current
        saved version. Added and removed words are highlighted.
      </p>
      <p>
        To bring an earlier version back, save or discard pending edits first, then choose{' '}
        <strong>Restore version</strong> with its version number. The version you replace stays in
        history. Changing only the filled inputs does not rewrite the saved template.
      </p>
    </GuideArticle>
  );
}
