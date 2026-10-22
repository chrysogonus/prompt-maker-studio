import type { ReactNode } from 'react';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { APP_NAME } from '@/lib/branding';
import type { Tool } from '@/lib/tools';
import guideStyles from '@/components/guides/Guides.module.css';
import ToolList from './ToolList';
import styles from './Tools.module.css';

export interface Faq {
  question: string;
  answer: string;
}

/**
 * A free tool: what it does, the tool itself, then server-rendered help and an
 * FAQ (also as FAQPage data) so the page is useful to readers and crawlers.
 */
export default function ToolPage({ tool, widget, faq, children, local = true }: {
  tool: Tool;
  widget: ReactNode;
  faq: Faq[];
  children: ReactNode;
  /** Browser-only tools say so; one that calls the server does not. */
  local?: boolean;
}) {
  const faqData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ question, answer }) => ({
      '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
  return (
    <article className={styles.toolArticle}>
      <nav aria-label="Breadcrumb" className={guideStyles.breadcrumb}>
        <Link href="/tools">All tools</Link>
      </nav>
      <header>
        <h1>{tool.title}</h1>
        <p className={guideStyles.intro}>{tool.description}</p>
        {/* Local tools say so in their description. */}
        {!local && <p className={styles.local}>When this site offers it, your prompt is sent to its AI provider to refine it and is not stored by this site.</p>}
      </header>
      <section className={styles.widget} aria-label={tool.title}>{widget}</section>
      <div className={guideStyles.prose}>
        {children}
        <h2>Questions</h2>
        {faq.map(({ question, answer }) => (
          <div key={question} className={styles.faq}>
            <h3>{question}</h3>
            <p>{answer}</p>
          </div>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqData) }} />
      <section className={guideStyles.next} aria-labelledby="keep-your-prompts">
        <h2 id="keep-your-prompts">Keep your prompts</h2>
        <p>
          Save prompts you reuse in your own library: sections, {'{{variables}}'}, folders and version
          history. Creating an account is free, and saving or filling in prompts needs no AI provider.
        </p>
        <div className={styles.actions}>
          <ButtonLink href="/library" variant="primary">Open the app</ButtonLink>
          <ButtonLink href="/gallery">Browse free templates</ButtonLink>
        </div>
      </section>
      <section className={guideStyles.next} aria-labelledby="more-tools">
        <h2 id="more-tools">More free tools</h2>
        <ToolList exclude={tool.path} />
      </section>
    </article>
  );
}
