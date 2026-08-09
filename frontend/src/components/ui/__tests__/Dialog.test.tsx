import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialog from '../Dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog isOpen={false} title="Delete account" onClose={vi.fn()}>
        Body
      </Dialog>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title and body when open', () => {
    render(
      <Dialog isOpen title="Delete account" onClose={vi.fn()}>
        This can&apos;t be undone.
      </Dialog>
    );
    expect(screen.getByRole('dialog', { name: 'Delete account' })).toBeInTheDocument();
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();
  });

  it('calls onClose when the overlay is clicked, but not when the dialog body is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Delete account" onClose={onClose}>
        Body
      </Dialog>
    );

    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
