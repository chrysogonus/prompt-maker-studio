import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CopyIcon, ProfileIcon, RefineIcon } from '../icon';

describe('Icon', () => {
  it('enforces the shared stroke, accessibility, and size defaults', () => {
    const { container } = render(
      <>
        <CopyIcon size="sm" />
        <RefineIcon size="lg" />
      </>,
    );
    const [copy, refine] = Array.from(container.querySelectorAll('svg'));

    expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect(copy).toHaveAttribute('focusable', 'false');
    expect(copy).toHaveAttribute('fill', 'none');
    expect(copy).toHaveAttribute('stroke-width', '1.5');
    expect(copy).toHaveAttribute('stroke-linecap', 'round');
    expect(copy).toHaveAttribute('stroke-linejoin', 'round');
    expect(copy).toHaveAttribute('width', '14');
    expect(copy).toHaveAttribute('height', '14');
    expect(refine).toHaveAttribute('width', '20');
    expect(refine).toHaveAttribute('height', '20');
  });

  it('supports the Settings size scale and labels meaningful standalone icons', () => {
    const { container } = render(
      <ProfileIcon size={18} tone="inherit" label="Profile section" />,
    );
    const icon = container.querySelector('svg');

    expect(icon).toHaveAttribute('width', '18');
    expect(icon).toHaveAttribute('height', '18');
    expect(icon).toHaveAttribute('aria-label', 'Profile section');
    expect(icon).not.toHaveAttribute('aria-hidden');
  });
});
