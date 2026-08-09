import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tag from '../Tag';

describe('Tag', () => {
  it('renders its label', () => {
    render(<Tag>gpt-4o</Tag>);
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('shows a remove button only when onRemove is provided, and calls it on click', async () => {
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>gpt-4o</Tag>);

    const removeButton = screen.getByRole('button', { name: 'Remove tag gpt-4o' });
    const tooltip = screen.getByRole('tooltip', { name: 'Remove tag gpt-4o' });
    expect(tooltip).toBeInTheDocument();
    expect(removeButton).toHaveAttribute('aria-describedby', tooltip.id);
    expect(removeButton.querySelector('svg')).toHaveAttribute('width', '12');

    await userEvent.click(removeButton);

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('omits the remove button when onRemove is not passed', () => {
    render(<Tag>gpt-4o</Tag>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
