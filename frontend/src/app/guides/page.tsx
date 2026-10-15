import GuideList from '@/components/guides/GuideList';
import styles from '@/components/guides/Guides.module.css';
import { APP_NAME } from '@/lib/branding';
import { GUIDES_INDEX, guideMetadata } from '@/lib/guides';

export function generateMetadata() {
  return guideMetadata(GUIDES_INDEX);
}

export default function GuidesPage() {
  return (
    <div className={styles.index}>
      <h1>{GUIDES_INDEX.title}</h1>
      <p className={styles.intro}>
        Keep the prompts that work, change their inputs, and find them again when you need them.
        These guides walk through real tasks in {APP_NAME}. Start with a reusable prompt,
        then learn how to fill it in and organize your library.
      </p>
      <GuideList />
      <p className={styles.intro}>
        Every guide is free to read without an account. The examples work with ChatGPT, Claude,
        Gemini, or any assistant you can paste text into.
      </p>
    </div>
  );
}
