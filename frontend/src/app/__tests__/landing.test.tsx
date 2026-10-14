import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LandingPage, { generateMetadata } from '../page';
import robots from '../robots';
import sitemap from '../sitemap';

const cookieNames = vi.hoisted(() => new Set<string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({ has: (name: string) => cookieNames.has(name) }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

afterEach(() => {
  cookieNames.clear();
  vi.unstubAllEnvs();
});

describe('Landing page', () => {
  it('describes the product to signed-out visitors and links into the app', async () => {
    render(await LandingPage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('reuse your best AI prompts');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/library');
    for (const link of screen.getAllByRole('link', { name: 'Open the app' })) {
      expect(link).toHaveAttribute('href', '/library');
    }
  });

  it('sends anyone with a session straight to their library', async () => {
    cookieNames.add('access_token');
    await expect(LandingPage()).rejects.toThrow('NEXT_REDIRECT /library');
  });

  it('builds canonical and preview links from FRONTEND_URL at request time', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example/');
    const metadata = await generateMetadata();

    expect(metadata.alternates?.canonical).toBe('https://prompts.example/');
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: 'https://prompts.example/landing/editor.png' }),
    ]);
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('point crawlers at the public origin and away from signed-in pages', () => {
    vi.stubEnv('FRONTEND_URL', 'https://prompts.example');
    const rules = robots();

    expect(rules.sitemap).toBe('https://prompts.example/sitemap.xml');
    expect(rules.rules).toMatchObject({ allow: '/', disallow: expect.arrayContaining(['/library', '/api/']) });
    expect(sitemap()).toEqual([{ url: 'https://prompts.example/' }]);
  });
});
