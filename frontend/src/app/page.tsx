/* eslint-disable @next/next/no-img-element -- the image ships without sharp, so next/image would serve these unoptimised anyway */
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LegalLinks from '@/components/LegalLinks';
import JsonLd, { FREE_OFFER, project } from '@/components/public/JsonLd';
import RepositoryLink, { REPOSITORY_URL } from '@/components/RepositoryLink';
import { ButtonLink } from '@/components/ui/Button';
import Wordmark from '@/components/ui/Wordmark';
import GuideList from '@/components/guides/GuideList';
import ToolList from '@/components/public/ToolList';
import guideStyles from '@/components/guides/Guides.module.css';
import { featuredTemplates, galleryPath } from '@/lib/gallery';
import { GUIDES } from '@/lib/guides';
import { APP_NAME, siteUrl } from '@/lib/branding';
import { availableLegalPages } from '@/lib/legal';
import styles from './page.module.css';

const DESCRIPTION =
  'A prompt library and template editor: save your best AI prompts with {{variables}}, fill them in ' +
  'and copy them into ChatGPT, Claude, Gemini or any assistant.';

export async function generateMetadata(): Promise<Metadata> {
  const url = siteUrl();
  const title = `${APP_NAME}: a prompt library and template editor`;
  const image = { url: `${url}/landing/editor.png`, width: 1440, height: 900 };
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: `${url}/` },
    openGraph: { type: 'website', url: `${url}/`, siteName: APP_NAME, title, description: DESCRIPTION, images: [image] },
    twitter: { card: 'summary_large_image', title, description: DESCRIPTION, images: [image.url] },
  };
}

// The public front door. Search engines and new visitors get a page that says
// what this is; anyone with a session goes straight to their library. An
// expired cookie lands on the library's sign-in form, which is what they need.
export default async function LandingPage() {
  if ((await cookies()).has('access_token')) redirect('/library');
  const url = `${siteUrl()}/`;
  const structuredData = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: APP_NAME, url, description: DESCRIPTION, publisher: project() },
    {
      '@context': 'https://schema.org', '@type': 'WebApplication',
      name: APP_NAME, url, description: DESCRIPTION,
      applicationCategory: 'BusinessApplication', operatingSystem: 'Web',
      isAccessibleForFree: true, offers: FREE_OFFER, author: project(),
    },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.home} aria-label={`${APP_NAME} home`}>
          <Wordmark icon="mark" />
        </Link>
        <nav aria-label="Main navigation" className={styles.navigation}>
          <Link href="/guides" className={styles.signIn}>Guides</Link>
          <Link href="/tools" className={styles.signIn}>Tools</Link>
          <Link href="/gallery" className={styles.signIn}>Templates</Link>
          <Link href="/library" className={styles.signIn}>Open the app</Link>
        </nav>
      </header>

      <main>
        <JsonLd data={structuredData} />
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1>Save, fill in and reuse your best AI prompts.</h1>
            <p className={styles.lede}>
              Keep the instructions that work. Fill in what changes, then copy a ready-to-use prompt
              into any AI assistant.
            </p>
            <div className={styles.actions}>
              <ButtonLink href="/library" variant="primary" className={styles.cta}>
                Open the app
              </ButtonLink>
              <RepositoryLink className={styles.sourceLink} />
            </div>
            <p className={styles.heroNote}>Sign in or create an account. Saving, filling in and copying need no AI provider.</p>
          </div>
          <figure className={styles.demo}>
            <div className={styles.demoTemplate}>
              <p className={styles.demoTitle}>Write it once</p>
              <pre><span className={styles.demoTag}>{'<TASK>\n'}</span>
                {'Write a '}
                <span className={styles.demoVariable}>{'{{tone}}'}</span>
                {' reply to a customer\nwhose order is '}
                <span className={styles.demoVariable}>{'{{days_late}}'}</span>
                {' days late.\nSay what happens next. Keep it under 120 words.\n'}
                <span className={styles.demoTag}>{'</TASK>'}</span>
              </pre>
            </div>
            <dl className={styles.demoInputs}>
              <div><dt>tone</dt><dd>warm and direct</dd></div>
              <div><dt>days_late</dt><dd>3</dd></div>
            </dl>
            <div className={styles.demoResult}>
              <p className={styles.demoTitle}>Make it yours</p>
              <pre><span className={styles.demoTag}>{'<TASK>\n'}</span>
                {'Write a '}
                <mark>warm and direct</mark>
                {' reply to a customer\nwhose order is '}
                <mark>3</mark>
                {' days late.\nSay what happens next. Keep it under 120 words.\n'}
                <span className={styles.demoTag}>{'</TASK>'}</span>
              </pre>
            </div>
            <figcaption>The same instructions. Fresh details every time.</figcaption>
          </figure>
        </section>

        <figure className={styles.shot}>
          <img
            src="/landing/editor.webp"
            srcSet="/landing/editor-720.webp 720w, /landing/editor.webp 1440w"
            sizes="(max-width: 1120px) 100vw, 1120px"
            width={1440}
            height={900}
            alt="The editor: a weekly status update prompt in Role, Context, Task and Format sections, with a filled-in preview ready to copy."
          />
        </figure>

        <section className={styles.features} aria-labelledby="features-title">
          <h2 id="features-title">Built for prompts you use more than once</h2>
          <dl>
            <div>
              <dt>Sections and variables</dt>
              <dd>
                Split a prompt into Role, Task, Format or any sections you name. Use{' '}
                <code className={styles.variable}>{'{{team}}'}</code> for the parts that change, with a
                hint for each one.
              </dd>
            </div>
            <div>
              <dt>Copy filled prompt</dt>
              <dd>
                Fill in the variables and copy the finished text, or copy the template as it is. The
                preview shows exactly what you will paste.
              </dd>
            </div>
            <div>
              <dt>Bring your existing prompts</dt>
              <dd>
                Paste a prompt or import Markdown notes, such as Notion or Obsidian exports. Importing
                copies them once; import again to add new notes or update prompts that changed.
                Placeholders like [topic] become inputs, and an AI provider you connect can split a
                prompt into sections for you to review.
              </dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>
                Every save keeps the previous version. Compare versions word by word and restore any
                of them.
              </dd>
            </div>
            <div>
              <dt>Folders, favourites and search</dt>
              <dd>Find a prompt by its name, its folder or any text inside it.</dd>
            </div>
            <div>
              <dt>Your library in ChatGPT and Claude</dt>
              <dd>
                Connect your account to ChatGPT or Claude to list, open, save and update prompts
                without leaving the chat. <Link href={GUIDES.connect.path}>See how</Link>.
              </dd>
            </div>
          </dl>
        </section>

        <figure className={styles.shot}>
          <img
            src="/landing/library.webp"
            srcSet="/landing/library-720.webp 720w, /landing/library.webp 1440w"
            sizes="(max-width: 1120px) 100vw, 1120px"
            width={1440}
            height={900}
            loading="lazy"
            alt="The prompt library: prompts sorted into folders, with favourites and search."
          />
        </figure>

        <section className={styles.features} aria-labelledby="guides-title">
          <h2 id="guides-title">Learn with examples</h2>
          <GuideList />
        </section>

        <section className={styles.features} aria-labelledby="templates-title">
          <h2 id="templates-title">Free prompt templates</h2>
          <ul className={guideStyles.guideList}>
            {featuredTemplates().map((template) => (
              <li key={template.slug}>
                <Link href={galleryPath(template.slug)}>{template.title}</Link>
                <p>{template.summary}</p>
              </li>
            ))}
          </ul>
          <p><Link href="/gallery" className={styles.signIn}>All templates</Link></p>
        </section>

        <section className={styles.features} aria-labelledby="tools-title">
          <h2 id="tools-title">Free prompt tools</h2>
          <ToolList />
        </section>

        <section className={styles.openSource} aria-labelledby="open-source-title">
          <h2 id="open-source-title">Open source, and yours to host</h2>
          <p>
            {APP_NAME} is licensed under Apache-2.0. Use it here, or run your own copy with Docker.
            Saving and filling in prompts needs no AI connection. Optional AI features use your own
            OpenAI, Anthropic, Gemini, Ollama or other OpenAI-compatible provider, or a shared
            connection when the server offers one.
          </p>
          <p>
            For a team, run one copy on a server you control. Each person keeps a private library, and
            you can set up a shared AI connection, such as a local model through Ollama or vLLM, for
            people without their own API key. The{' '}
            <a href={`${REPOSITORY_URL}/blob/main/docs/deployment.md`}>deployment guide</a>{' '}
            covers the setup.
          </p>
          <ButtonLink href="/library" variant="primary" className={styles.cta}>
            Open the app
          </ButtonLink>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          &copy; {new Date().getFullYear()} {APP_NAME}. Licensed under{' '}
          <a href="https://github.com/chrysogonus/prompt-maker-studio/blob/main/LICENSE">Apache-2.0</a>.
        </span>
        <Link href="/about">About</Link>
        <LegalLinks className={styles.legalLinks} pages={await availableLegalPages()} />
      </footer>
    </div>
  );
}
