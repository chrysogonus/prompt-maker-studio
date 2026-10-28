import guideStyles from '@/components/guides/Guides.module.css';
import JsonLd, { collection } from '@/components/public/JsonLd';
import ToolList from '@/components/public/ToolList';
import { TOOLS, TOOLS_INDEX, toolMetadata } from '@/lib/tools';

export function generateMetadata() {
  return toolMetadata(TOOLS_INDEX);
}

export default function ToolsIndexPage() {
  return (
    <section className={guideStyles.index}>
      <h1>{TOOLS_INDEX.title}</h1>
      <p className={guideStyles.intro}>
        Small tools for writing, checking and reusing AI prompts. They need no account, and the
        browser-based ones never upload what you type.
      </p>
      <ToolList />
      <JsonLd data={collection(TOOLS_INDEX, Object.values(TOOLS).map(({ path }) => path))} />
    </section>
  );
}
