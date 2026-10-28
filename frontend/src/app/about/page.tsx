import Link from 'next/link';
import guideStyles from '@/components/guides/Guides.module.css';
import JsonLd, { MAINTAINER, project } from '@/components/public/JsonLd';
import PublicShell from '@/components/public/PublicShell';
import { REPOSITORY_URL } from '@/components/RepositoryLink';
import { APP_NAME, siteUrl } from '@/lib/branding';
import { GUIDES, guideMetadata } from '@/lib/guides';
import { availableLegalPages } from '@/lib/legal';

// The host and the operator's legal pages are only known at request time.
export const dynamic = 'force-dynamic';

const ABOUT = {
  path: '/about',
  title: `About ${APP_NAME}`,
  description: `What ${APP_NAME} is, who builds it, how it handles your prompts and who runs this site. An open-source prompt library to use here or host yourself.`,
};

export function generateMetadata() {
  return guideMetadata(ABOUT);
}

export default async function AboutPage() {
  const legal = await availableLegalPages();
  const host = new URL(siteUrl()).host;
  return (
    <PublicShell contentId="about-content" homeLabel="Home" homeHref="/" legalPages={legal}>
      <article className={guideStyles.article}>
        <header>
          <h1>{ABOUT.title}</h1>
          <p className={guideStyles.intro}>
            {APP_NAME} is an open-source prompt library and template editor. Save the AI prompts you
            reuse as named sections with {'{{variables}}'}, fill them in, and copy them into ChatGPT,
            Claude, Gemini or any other assistant.
          </p>
        </header>
        <JsonLd data={{ '@context': 'https://schema.org', '@type': 'AboutPage', name: ABOUT.title, url: `${siteUrl()}${ABOUT.path}`, mainEntity: project() }} />
        <div className={guideStyles.prose}>
          <h2>What it does</h2>
          <ul>
            <li>Keeps your prompts in a library with folders, favourites, search and a version history.</li>
            <li>Turns the parts that change into inputs, so you fill in a prompt instead of rewriting it.</li>
            <li>
              Connects to ChatGPT and Claude, so you can use your library from the chat; see{' '}
              <Link href={GUIDES.connect.path}>how to use your prompt library in ChatGPT and Claude</Link>.
            </li>
            <li>
              Offers <Link href="/guides">guides</Link>, <Link href="/tools">free tools</Link> and{' '}
              <Link href="/gallery">prompt templates</Link> that need no account.
            </li>
          </ul>

          <h2>Who builds it</h2>
          <p>
            {APP_NAME} is built and maintained in the open by{' '}
            <a href={MAINTAINER.url}>@{MAINTAINER.name}</a> on GitHub. The code, every change and the
            reasons behind past decisions are public in the <a href={REPOSITORY_URL}>repository</a>.
            Report a problem or suggest an improvement through{' '}
            <a href={`${REPOSITORY_URL}/issues`}>GitHub issues</a>, and see what changed in each
            version in the <a href={`${REPOSITORY_URL}/releases`}>release notes</a>.
          </p>

          <h2>Open source</h2>
          <p>
            {APP_NAME} is licensed under Apache-2.0. Anyone can read the code, adapt it or run their
            own copy with Docker, for themselves or for a team.
          </p>

          <h2>How it handles your prompts</h2>
          <ul>
            <li>Your prompts are stored in your account on the site you use; other accounts cannot see them.</li>
            <li>Saving, filling in and copying prompts happen without any AI provider.</li>
            <li>
              Optional AI features, such as refining a prompt or trying it once, use the provider you
              connect, or a shared one when the site offers it. Signed in, each AI action names the
              connection it uses.
            </li>
            <li>
              ChatGPT and Claude reach your library only after you sign in and allow access, and you
              can disconnect them in Settings at any time.
            </li>
          </ul>

          <h2>This site</h2>
          <p>
            {host} runs {APP_NAME}.
            {legal.includes('impressum') && <> Its operator is named in the <a href="/impressum">Impressum</a>.</>}
            {legal.includes('datenschutz') && <> The <a href="/datenschutz">privacy policy</a> explains what this site stores and why.</>}
          </p>
        </div>
      </article>
    </PublicShell>
  );
}
