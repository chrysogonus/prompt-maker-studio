/* eslint-disable @next/next/no-img-element -- the image ships without sharp, so next/image would serve these unoptimised anyway */
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LegalLinks from '@/components/LegalLinks';
import RepositoryLink from '@/components/RepositoryLink';
import { ButtonLink } from '@/components/ui/Button';
import Wordmark from '@/components/ui/Wordmark';
import GuideList from '@/components/guides/GuideList';
import { APP_NAME, siteUrl } from '@/lib/branding';
import styles from './page.module.css';

const DESCRIPTION =
  'A prompt library and template editor. Save your best AI prompts as sections with {{variables}}, ' +
  'fill them in, and copy them into ChatGPT, Claude, Gemini or any other assistant.';

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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.home} aria-label={`${APP_NAME} home`}>
          <Wordmark icon="mark" />
        </Link>
        <nav aria-label="Main navigation" className={styles.navigation}>
          <Link href="/guides" className={styles.signIn}>Guides</Link>
          <Link href="/library" className={styles.signIn}>Sign in</Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <h1>Save, fill in and reuse your best AI prompts.</h1>
          <p className={styles.lede}>
            {APP_NAME} is a prompt library and template editor. Write each prompt as named sections,
            mark the parts that change with <code className={styles.variable}>{'{{variables}}'}</code>,
            and copy a filled-in version into ChatGPT, Claude, Gemini or any other assistant.
          </p>
          <div className={styles.actions}>
            <ButtonLink href="/library" variant="primary" className={styles.cta}>
              Open the app
            </ButtonLink>
            <RepositoryLink />
          </div>
        </section>

        <figure className={styles.shot}>
          <img
            src="/landing/editor.png"
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
              <dt>Paste a prompt</dt>
              <dd>
                Already have a prompt that works? Paste it, and the AI provider you connect splits it
                into sections and turns its details into variables for you to review.
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
              <dt>Folders, favorites and search</dt>
              <dd>Find a prompt by its name, its folder or any text inside it.</dd>
            </div>
            <div>
              <dt>Your library in ChatGPT</dt>
              <dd>
                Connect your account to ChatGPT to list, open and save prompts without leaving the
                chat.
              </dd>
            </div>
          </dl>
        </section>

        <figure className={styles.shot}>
          <img
            src="/landing/library.png"
            width={1440}
            height={900}
            loading="lazy"
            alt="The prompt library: prompts sorted into folders, with favorites and search."
          />
        </figure>

        <section className={styles.features} aria-labelledby="guides-title">
          <h2 id="guides-title">Learn with examples</h2>
          <GuideList />
        </section>

        <section className={styles.openSource} aria-labelledby="open-source-title">
          <h2 id="open-source-title">Open source, and yours to host</h2>
          <p>
            {APP_NAME} is licensed under Apache-2.0. Use it here, or run your own copy with Docker.
            Saving and filling in prompts needs no AI connection. Paste a prompt uses your own OpenAI,
            Anthropic, Gemini, Ollama or other OpenAI-compatible provider.
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
        <LegalLinks className={styles.legalLinks} />
      </footer>
    </div>
  );
}
