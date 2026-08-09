import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SegmentedControl from '../SegmentedControl';

const options = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const;

describe('SegmentedControl', () => {
  it('marks the active option as checked', () => {
    render(
      <SegmentedControl
        options={options}
        value="compact"
        onChange={vi.fn()}
        aria-label="Density"
      />
    );

    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('calls onChange with the clicked option value', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={options}
        value="comfortable"
        onChange={onChange}
        aria-label="Density"
      />
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }));

    expect(onChange).toHaveBeenCalledWith('compact');
  });
});
