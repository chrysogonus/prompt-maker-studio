import LLMConnectionForm from '@/features/settings/LLMConnectionForm';

import styles from './SettingsPage.module.css';

export function ConnectionSettings() {
  return (
    <section className={styles.section} id="s-api" aria-labelledby="h-api">
      <div className={styles.intro}>
        <h2 id="h-api">AI connection</h2>
        <p>Optional. Everything else works without it.</p>
      </div>
      <div className={styles.body}>
        <p className={styles.text}>
          The AI connection powers <strong>Import text</strong>, which turns a pasted prompt or
          rough notes into sections you can edit. Connect your own OpenAI-compatible provider, or
          use this server&apos;s default connection when it offers one.
        </p>
        <LLMConnectionForm />
      </div>
    </section>
  );
}
