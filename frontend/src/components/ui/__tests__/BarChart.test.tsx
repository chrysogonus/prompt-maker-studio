import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import BarChart from '../BarChart';
import styles from '../BarChart.module.css';

describe('BarChart', () => {
  it('renders one column per datum, labeled by its tick', () => {
    render(
      <BarChart
        ariaLabel="Requests, last 7 days"
        data={[
          { label: 'Mon', value: 10 },
          { label: 'Tue', value: 20 },
        ]}
      />
    );

    expect(screen.getAllByText('Mon')).toHaveLength(2); // visible tick + a11y table
    expect(screen.getAllByText('Tue')).toHaveLength(2);
  });

  it('exposes the figures, not just the bar heights, to assistive tech', () => {
    render(
      <BarChart
        ariaLabel="Requests, last 7 days"
        data={[
          { label: 'Mon', value: 10 },
          { label: 'Tue', value: 20 },
        ]}
      />
    );

    const table = screen.getByRole('table', { name: 'Requests, last 7 days' });
    expect(table.parentElement).toHaveClass(styles.visuallyHidden);
    expect(table).not.toHaveClass(styles.visuallyHidden);
    expect(within(table).getByRole('rowheader', { name: 'Mon' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '10' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '20' })).toBeInTheDocument();
  });

  it('handles an all-zero series without dividing by zero', () => {
    render(
      <BarChart
        ariaLabel="Requests"
        data={[
          { label: 'Mon', value: 0 },
          { label: 'Tue', value: 0 },
        ]}
      />
    );
    expect(screen.getByRole('table', { name: 'Requests' })).toBeInTheDocument();
  });
});
