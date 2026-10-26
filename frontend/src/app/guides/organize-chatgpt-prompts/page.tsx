/* eslint-disable @next/next/no-img-element -- reuse the static screenshots shipped with the landing page */
import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { APP_NAME } from '@/lib/branding';
import { GUIDES, guideMetadata } from '@/lib/guides';

export function generateMetadata() {
  return guideMetadata(GUIDES.organize);
}

export default function OrganizePromptsPage() {
  return (
    <GuideArticle guide={GUIDES.organize}>
      <p>
        Keep the prompts worth reusing in a separate library so you can find them without searching
        old conversations. {APP_NAME} stores your prompt templates; you can fill one in, copy it,
        and paste it into a new ChatGPT conversation whenever you need it. The same approach works
        with Claude, Gemini, and other assistants.
      </p>

      <h2>Name prompts by the task they help you finish</h2>
      <p>
        Prefer names such as &quot;Weekly status update,&quot; &quot;Rewrite a customer reply,&quot;
        or &quot;Summarize meeting actions&quot; over &quot;Prompt 1.&quot; A name should tell you
        when to use the prompt. To change a saved name, open its more-actions menu in the library,
        choose <strong>Rename</strong>, edit the name, and press Enter.
      </p>

      <h2>Group related prompts in folders</h2>
      <ol>
        <li>
          When saving a new prompt, enter a <strong>Folder</strong>, such as Work, Writing, or
          Learning. Pick an existing name or type a new one, then choose <strong>Save prompt</strong>.
        </li>
        <li>
          To file an existing prompt, open its more-actions menu and choose{' '}
          <strong>Move to folder…</strong>. Enter a folder name and choose <strong>Move</strong>.
        </li>
        <li>
          Select that folder in the sidebar to see its prompts. On a phone, open the navigation
          menu first. Leave the folder field empty when moving a prompt to keep it{' '}
          <strong>Unfiled</strong>.
        </li>
      </ol>
      <p>
        A folder appears once a prompt is filed in it. Folders form one flat list; you do not
        need to create empty folders first. From a folder&apos;s actions menu, you can rename it
        or remove it. Removing a folder keeps its prompts and makes them unfiled. Renaming onto
        an existing folder merges the two.
      </p>
      <figure>
        <img src="/landing/library.png" width={1440} height={900} loading="lazy"
          alt="Prompt library with folders in the sidebar, a search field, and reusable prompts with favorite controls." />
        <figcaption>Folders narrow the library; stars keep frequently used prompts easy to reach.</figcaption>
      </figure>

      <h2>Keep frequent prompts in Favourites</h2>
      <p>
        Select the star beside a prompt, then choose <strong>Favourites</strong> in the sidebar.
        Starring a prompt leaves it in its folder too. Use this view for the few templates you
        reach for most often.
      </p>

      <h2>Search the right part of your library</h2>
      <p>
        Use <strong>Search prompts</strong> to search prompt names, folder names, section names,
        and section text. Search narrows the current view: if you are in Favourites or a folder,
        it searches those prompts. Select <strong>All prompts</strong> before searching the
        entire library. Results show the most recently edited prompts first.
      </p>

      <h2>Reuse a prompt and keep its improvements</h2>
      <p>
        For a prompt with variables, choose <strong>Fill and copy</strong> in the library. Enter
        the values, then choose <strong>Copy filled prompt</strong> and paste it into ChatGPT.
        The library&apos;s <strong>Copy template</strong> action copies the unchanged template
        with its placeholders. See the{' '}
        <Link href={GUIDES.variables.path}>variables guide</Link> for complete and incomplete copies.
      </p>
      <p>
        Edit the saved template when you find a better instruction, then choose <strong>Save</strong>.
        In <strong>Tools → History</strong>, select an earlier version to compare it with the current
        saved version. Save or discard pending edits before choosing <strong>Restore version</strong>{' '}
        with its number. Restoring keeps the version you replace in history.
      </p>

      <h2>Optional: use your library from inside ChatGPT or Claude</h2>
      <p>
        Copying and pasting works without connecting ChatGPT or Claude to your library. If you
        choose to connect the optional integration, it can list, open, save and update your prompts from
        the chat after you sign in and grant access. In the app, <strong>Settings → ChatGPT and
        Claude</strong> gives the server address and the steps for each app; the{' '}
        <a href="https://github.com/chrysogonus/prompt-maker-studio/blob/main/docs/mcp.md">
          technical documentation
        </a>{' '}
        covers self-hosting details. This is a separate connection from the AI provider used by
        Paste a prompt, Refine, or Try once.
      </p>
    </GuideArticle>
  );
}
