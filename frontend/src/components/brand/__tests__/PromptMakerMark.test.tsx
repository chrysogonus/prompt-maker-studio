import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PromptMakerMark, PromptMakerTile } from '../PromptMakerMark';

describe('PromptMakerMark', () => {
  it('names the brand when used on its own', () => {
    render(<PromptMakerMark />);

    expect(screen.getByRole('img', { name: 'Prompt Maker Studio' })).toBeInTheDocument();
  });

  it('is hidden from assistive technology when adjacent text names the brand', () => {
    const { container } = render(<PromptMakerMark decorative />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the tile decorative for use beside the wordmark', () => {
    const { container } = render(<PromptMakerTile />);

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
