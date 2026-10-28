import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyButton from '../public/CopyButton';

afterEach(() => vi.restoreAllMocks());

describe('CopyButton', () => {
  it('copies its text and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<CopyButton text="<GOAL>Fix it</GOAL>" label="Copy bug fix brief" />);

    await user.click(screen.getByRole('button', { name: 'Copy bug fix brief' }));

    expect(writeText).toHaveBeenCalledWith('<GOAL>Fix it</GOAL>');
    expect(screen.getByRole('status')).toHaveTextContent('Copied.');
  });

  it('tells the reader to copy by hand when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<CopyButton text="x" label="Copy template" />);

    await user.click(screen.getByRole('button', { name: 'Copy template' }));

    expect(screen.getByRole('status')).toHaveTextContent('Copying failed. Select the text above and copy it.');
  });
});
