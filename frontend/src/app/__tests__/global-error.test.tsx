import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GlobalError from '../global-error';

// GlobalError renders its own <html>/<body> (it replaces the root layout when
// the root layout itself throws), so it can't be mounted via Testing
// Library's usual container-based render. renderToStaticMarkup exercises the
// same rendering path Next.js uses server-side without that constraint.
describe('Root error boundary (app/global-error.tsx)', () => {
  it('renders without throwing and includes a recovery action', () => {
    const markup = renderToStaticMarkup(<GlobalError error={new Error('boom')} reset={vi.fn()} />);

    expect(markup).toContain('Something went wrong');
    expect(markup).toContain('Try again');
  });
});
