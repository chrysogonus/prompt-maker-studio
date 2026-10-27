import guideStyles from '@/components/guides/Guides.module.css';
import JsonLd, { collection } from '@/components/public/JsonLd';
import GalleryBrowser from '@/features/gallery/GalleryBrowser';
import { GALLERY, GALLERY_INDEX, galleryMetadata, galleryPath } from '@/lib/gallery';

export function generateMetadata() {
  return galleryMetadata();
}

export default function GalleryPage() {
  return (
    <section className={guideStyles.index}>
      <h1>{GALLERY_INDEX.title}</h1>
      <p className={guideStyles.intro}>
        Ready-to-use prompt templates, free to copy and change. Fill in the parts in{' '}
        {'{{double braces}}'} right on the page, copy the result into any AI assistant, or save the
        template to your own library.
      </p>
      <GalleryBrowser />
      <JsonLd data={collection(GALLERY_INDEX, GALLERY.map(({ slug }) => galleryPath(slug)))} />
    </section>
  );
}
