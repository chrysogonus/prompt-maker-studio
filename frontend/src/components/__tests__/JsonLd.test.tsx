import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import JsonLd from '../public/JsonLd';

describe('JsonLd', () => {
  it('keeps a value from closing its script element', () => {
    const { container } = render(<JsonLd data={{ name: '</script><script>alert(1)</script>' }} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;

    expect(script.innerHTML).not.toContain('</script>');
    expect(JSON.parse(script.textContent!).name).toBe('</script><script>alert(1)</script>');
  });
});
