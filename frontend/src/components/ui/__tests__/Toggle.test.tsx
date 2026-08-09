import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toggle from '../Toggle';

describe('Toggle', () => {
  it('reflects checked state via aria-checked', () => {
    render(<Toggle checked label="Weekly summary" onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Weekly summary' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('calls onChange with the flipped value when clicked', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} label="Weekly summary" onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Weekly summary' }));

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
