import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Card from '../Card';

describe('Card', () => {
  it('renders a plain div with no interactive semantics by default', () => {
    render(<Card data-testid="card">content</Card>);
    const card = screen.getByTestId('card');
    expect(card).not.toHaveAttribute('role');
    expect(card).not.toHaveAttribute('tabindex');
  });

  it('is keyboard-focusable and exposes a button role when interactive with an onClick', () => {
    render(
      <Card interactive onClick={vi.fn()} data-testid="card">
        content
      </Card>
    );
    const card = screen.getByRole('button');
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('activates onClick on Enter when the card itself is focused', async () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        Open prompt
      </Card>
    );

    const card = screen.getByRole('button');
    card.focus();
    await userEvent.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates onClick on Space when the card itself is focused', async () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        Open prompt
      </Card>
    );

    const card = screen.getByRole('button');
    card.focus();
    await userEvent.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not double-activate when Enter is pressed on a nested interactive child', async () => {
    // Matches real usage (e.g. the Library's favorite/rename/delete buttons
    // nested inside an interactive Card): the nested control stops
    // propagation on its own click, same as it would for a mouse click.
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        <button type="button" data-testid="nested" onClick={(e) => e.stopPropagation()}>
          Favorite
        </button>
      </Card>
    );

    screen.getByTestId('nested').focus();
    await userEvent.keyboard('{Enter}');

    expect(onClick).not.toHaveBeenCalled();
  });
});
