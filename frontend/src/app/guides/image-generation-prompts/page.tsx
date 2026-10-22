import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { GUIDES, guideMetadata } from '@/lib/guides';
import { TOOLS } from '@/lib/tools';

const template = 'A {{shot}} of {{subject}}, {{action}}, in {{setting}}. {{style}} style, {{lighting}} lighting, {{palette}} colour palette. {{aspect}} aspect ratio. Avoid: {{avoid}}.';
const filled = 'A close-up of an old ceramic teapot, steam rising, on a wooden kitchen table by a window. Soft watercolour style, early-morning lighting, muted green and cream colour palette. 3:2 aspect ratio. Avoid: text, logos, extra cups.';

export function generateMetadata() {
  return guideMetadata(GUIDES.imagePrompts);
}

export default function ImagePromptsPage() {
  return (
    <GuideArticle guide={GUIDES.imagePrompts}>
      <p>
        Image models such as DALL·E, Midjourney, Stable Diffusion or Gemini turn a description into
        a picture. They follow concrete visual words far better than abstract ones: &quot;a lighthouse
        at dusk, warm window light&quot; works; &quot;a hopeful image&quot; leaves almost everything to
        chance.
      </p>

      <h2>The parts of an image prompt</h2>
      <ol>
        <li><strong>Subject</strong>: what is in the picture, with the details that matter: age, material, colour, count.</li>
        <li><strong>Action and setting</strong>: what is happening and where.</li>
        <li><strong>Shot and composition</strong>: close-up, wide shot, from above, centred, rule of thirds.</li>
        <li><strong>Style</strong>: photograph, watercolour, 3D render, flat illustration, a period or medium.</li>
        <li><strong>Lighting and colour</strong>: golden hour, studio light, overcast; a palette.</li>
        <li><strong>Format</strong>: aspect ratio, and whether you need empty space for text.</li>
        <li><strong>What to avoid</strong>: text, watermarks, extra limbs, clutter. Some tools have a separate negative prompt field for this.</li>
      </ol>

      <h2>A template you can reuse</h2>
      <pre><code>{template}</code></pre>
      <p>Filled in, it might read:</p>
      <pre><code>{filled}</code></pre>
      <p>
        Fill the variables with the <Link href={TOOLS.filler.path}>template filler</Link>, then paste
        the result into your image tool.
      </p>

      <h2>Iterate one change at a time</h2>
      <ul>
        <li>Generate a few images, keep the best, and change one detail, such as lighting, before generating again.</li>
        <li>Put the most important detail early. Many models weight the start of a prompt more heavily.</li>
        <li>Avoid copying living artists&apos; names. Describe the qualities you want instead: loose brushwork, high contrast, muted colours.</li>
        <li>Keep the versions that worked. The <Link href={TOOLS.diff.path}>prompt diff</Link> shows what you changed between them.</li>
      </ul>
      <p>
        For the general structure of text prompts, read{' '}
        <Link href={GUIDES.goodPrompt.path}>what makes a good prompt</Link>.
      </p>
    </GuideArticle>
  );
}
