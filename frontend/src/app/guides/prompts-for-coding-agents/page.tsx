import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { GALLERY, galleryPath } from '@/lib/gallery';
import { GUIDES, guideMetadata } from '@/lib/guides';
import { renderSections } from '@/lib/sections';
import { TOOLS } from '@/lib/tools';

export function generateMetadata() {
  return guideMetadata(GUIDES.codingAgents);
}

export default function CodingAgentPromptsPage() {
  return (
    <GuideArticle guide={GUIDES.codingAgents}>
      <p>
        Coding agents such as Claude Code, Codex or Cursor act on your repository: they read files,
        run commands and edit code. A prompt for them is closer to a work ticket than to a question.
        The clearer it is about scope, checks and when to stop, the less you have to undo.
      </p>

      <h2>What a coding-agent prompt should state</h2>
      <ul>
        <li><strong>The goal</strong> in one sentence, with the observable symptom for a bug: what happens, and what should happen instead.</li>
        <li><strong>Where to look</strong>: the files, modules or commands involved, and the project instructions file if your repository has one.</li>
        <li><strong>Constraints</strong>: what must not change, such as public APIs, dependencies, database schema or unrelated files, and whether to commit.</li>
        <li><strong>A definition of done</strong> the agent can check itself: a failing test that must pass, a command that must succeed.</li>
        <li><strong>When to stop and ask</strong>: before destructive actions, schema changes, or when the cause is not what you described.</li>
        <li><strong>What to report</strong>: what it changed, which checks it ran and their results, and what it could not verify.</li>
      </ul>

      <h2>Six templates for common agent tasks</h2>
      <p>
        Each states the task, its limits and what to hand back, so the agent&apos;s work stays
        reviewable. The variables keep a template reusable: open one to fill in its inputs on the
        page, or paste your own version into the <Link href={TOOLS.filler.path}>template filler</Link>.
      </p>
      {GALLERY.filter((template) => template.category === 'coding').map((template) => (
        <section key={template.slug} aria-labelledby={`template-${template.slug}`}>
          <h3 id={`template-${template.slug}`}>{template.title}</h3>
          <p>{template.summary} <Link href={galleryPath(template.slug)}>Fill it in</Link>.</p>
          <pre><code>{renderSections(template.sections)}</code></pre>
        </section>
      ))}

      <h2>Common mistakes</h2>
      <ul>
        <li><strong>Several tasks in one prompt.</strong> &quot;Fix the bug, refactor the module and update the docs&quot; produces one large change that is hard to review. Ask for one, review it, then ask for the next.</li>
        <li><strong>No way to verify.</strong> Without a test or command, the agent can only claim success. Name the check.</li>
        <li><strong>Guessing at the fix.</strong> Describe the symptom and ask for the root cause, rather than prescribing a change you have not confirmed.</li>
        <li><strong>Unstated limits.</strong> If the agent must not touch deployment files or push to a shared branch, say so.</li>
      </ul>
      <p>
        Check a draft with the <Link href={TOOLS.linter.path}>prompt checker</Link>, and see{' '}
        <Link href={GUIDES.goodPrompt.path}>what makes a good prompt</Link> for the general structure.
      </p>
    </GuideArticle>
  );
}
