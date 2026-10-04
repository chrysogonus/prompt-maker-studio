import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegalLinks from '@/components/LegalLinks';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LegalLinks', () => {
  it('links each page the deployment provides', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ pages: ['impressum', 'datenschutz'] }),
    );
    render(<LegalLinks />);

    expect(await screen.findByRole('link', { name: 'Impressum' })).toHaveAttribute(
      'href',
      '/impressum',
    );
    expect(screen.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute(
      'href',
      '/datenschutz',
    );
  });

  it('renders nothing when the deployment provides no pages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ pages: [] }));
    const { container } = render(<LegalLinks />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/legal.json'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the lookup fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const { container } = render(<LegalLinks />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
