import Link from 'next/link';
import { TOOLS } from '@/lib/tools';
import guideStyles from '@/components/guides/Guides.module.css';

export default function ToolList({ exclude }: { exclude?: string }) {
  return (
    <ul className={guideStyles.guideList}>
      {Object.values(TOOLS).filter((tool) => tool.path !== exclude).map((tool) => (
        <li key={tool.path}>
          <Link href={tool.path}>{tool.title}</Link>
          <p>{tool.description}</p>
        </li>
      ))}
    </ul>
  );
}
