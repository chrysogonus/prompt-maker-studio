import { ArrowUpRight, CodeXml } from 'lucide-react';
import styles from './RepositoryLink.module.css';

export default function RepositoryLink({ className }: { className?: string }) {
  return (
    <a
      href="https://github.com/chrysogonus/prompt-maker-studio"
      className={[styles.link, className].filter(Boolean).join(' ')}
      aria-label="Open source on GitHub"
      title="Open source on GitHub"
    >
      <CodeXml size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>Open source on GitHub</span>
      <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}
