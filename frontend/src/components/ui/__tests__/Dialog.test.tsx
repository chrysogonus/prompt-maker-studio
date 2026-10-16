import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
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

  it('keeps focus in the field being typed in when the parent re-renders', async () => {
    // A parent re-rendering on every keystroke passes a new inline onClose each
    // time; that must not re-run the open-focus logic and steal focus.
    function Form() {
      const [folder, setFolder] = useState('');
      return (
        <Dialog isOpen title="Save prompt" onClose={() => setFolder('')}>
          <input aria-label="Name" />
          <input aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)} />
        </Dialog>
      );
    }
    render(<Form />);

    await userEvent.click(screen.getByLabelText('Folder'));
    await userEvent.type(screen.getByLabelText('Folder'), 'Work');

    expect(screen.getByLabelText('Folder')).toHaveValue('Work');
    expect(screen.getByLabelText('Folder')).toHaveFocus();
  });

  it('closes on Escape and keeps Tab focus inside the dialog', async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Save prompt" onClose={onClose}>
        <input aria-label="First" />
        <button type="button">Last</button>
      </Dialog>
    );

    expect(screen.getByLabelText('First')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('First')).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it('keeps focus inside when Tab starts on a review heading', async () => {
  render(<>
    <button>Outside</button>
    <Dialog isOpen title="Review" onClose={vi.fn()}>
      <h3 tabIndex={-1}>Review heading</h3>
      <input aria-label="First input" />
      <button>Last action</button>
    </Dialog>
  </>);
  screen.getByRole('heading', { name: 'Review heading' }).focus();
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
  screen.getByRole('heading', { name: 'Review heading' }).focus();
  await userEvent.tab();
  expect(screen.getByLabelText('First input')).toHaveFocus();
});

it('returns focus to its opener even when a field inside autofocuses', async () => {
  function Opener() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog isOpen={open} title="Paste" onClose={() => setOpen(false)}>
        <textarea aria-label="Text" autoFocus />
      </Dialog>
    </>;
  }
  render(<Opener />);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByLabelText('Text')).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
});
