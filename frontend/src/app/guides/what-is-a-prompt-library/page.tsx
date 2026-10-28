import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { APP_NAME } from '@/lib/branding';
import { GALLERY, GALLERY_CATEGORIES } from '@/lib/gallery';
import { GUIDES, guideMetadata } from '@/lib/guides';

export function generateMetadata() {
  return guideMetadata(GUIDES.library);
}

export default function PromptLibraryPage() {
  return (
    <GuideArticle guide={GUIDES.library}>
      <p>
        A prompt library is a collection of the prompts you reuse, kept in one place under clear
        names, so you can find, fill in and improve them instead of rewriting them in every chat.
        It can be a document, a notes folder or an app. What matters is that each prompt is saved
        in a form you can use again.
      </p>
      <p>
        The term covers two things. A <strong>public</strong> prompt library is a collection to
        browse and borrow from, such as the <Link href="/gallery">free templates here</Link>. A{' '}
        <strong>personal</strong> library holds your own prompts, with the details only you know.
        Most people start from the first and end up with the second.
      </p>

      <h2>What belongs in it</h2>
      <ul>
        <li>Prompts you use more than once, such as a weekly update, a code review or an email reply.</li>
        <li>Prompts that took several tries to get right, so the working version is not lost in a chat history.</li>
        <li>Templates whose details change each time: a team name, this week&apos;s notes, a deadline.</li>
      </ul>
      <p>One-off questions do not need saving. If you have typed something similar twice, save it.</p>

      <h2>What makes an entry useful</h2>
      <ul>
        <li><strong>A name that says when to use it</strong>: &quot;Reply to a refund request&quot;, not &quot;Prompt 3&quot;.</li>
        <li>
          <strong>Clear parts</strong>: who the model should be, the context, the task, the format and the limits.{' '}
          <Link href={GUIDES.goodPrompt.path}>What makes a good AI prompt</Link> explains each.
        </li>
        <li>
          <strong>Variables for what changes</strong>, written as <code>{'{{notes}}'}</code>, so you
          fill in a value instead of editing the text. See{' '}
          <Link href={GUIDES.variables.path}>how to use variables in AI prompt templates</Link>.
        </li>
        <li><strong>Earlier versions</strong>, so a change that made answers worse can be undone.</li>
      </ul>

      <h2>A document or a dedicated tool</h2>
      <p>
        A shared document or notes app is the quickest start and costs nothing. It gets awkward as the
        collection grows: you edit the text each time you use a prompt, search finds words but not
        purpose, and an improvement overwrites what worked before.
      </p>
      <p>
        A dedicated tool such as {APP_NAME} keeps each prompt as named sections with variables,
        fills them in and copies the finished text, keeps every saved version, and sorts prompts into
        folders and favourites. It can also <Link href={GUIDES.connect.path}>connect to ChatGPT and
        Claude</Link>, so you can open and save prompts from the chat. Each account&apos;s library is
        private to that account.
      </p>

      <h2>Start from a free library</h2>
      <p>
        The <Link href="/gallery">template gallery</Link> has {GALLERY.length} ready-to-use prompts in{' '}
        {GALLERY_CATEGORIES.length} groups: {GALLERY_CATEGORIES.map((category) => category.label.toLowerCase()).join(', ')}.
        Fill one in on the page without an account, or save it to your own library and adapt it.
      </p>

      <h2>Keep it useful</h2>
      <ul>
        <li>Rename prompts when their purpose changes, and remove ones you no longer use.</li>
        <li>Star the few you use every week so they are one click away.</li>
        <li>Change one instruction at a time and compare the answers before you keep the new version.</li>
      </ul>
      <p>
        <Link href={GUIDES.organize.path}>How to organize and reuse your ChatGPT prompts</Link> walks
        through folders, favourites and search step by step.
      </p>
    </GuideArticle>
  );
}
