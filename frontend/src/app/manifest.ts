import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Prompt Maker Studio',
    short_name: 'Prompt Maker',
    description: 'Generate structured prompts with ease',
    start_url: '/',
    display: 'standalone',
    icons: [
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/apple-touch-icon-180.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    theme_color: '#F0997B',
    background_color: '#0E0E10',
  };
}
