import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button, { ButtonLink } from '../Button';

describe('Button', () => {
  it('renders children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type="button" so it never submits a surrounding form', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('renders link actions as a single semantic link and forwards attributes', async () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    render(
      <ButtonLink href="/editor/new" variant="primary" aria-label="Start a new prompt" onClick={onClick}>
        + New prompt
      </ButtonLink>
    );

    const link = screen.getByRole('link', { name: 'Start a new prompt' });
    expect(link).toHaveAttribute('href', '/editor/new');
    expect(link.querySelector('button')).toBeNull();

    await userEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
