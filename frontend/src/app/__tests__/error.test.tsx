import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorPage from '../error';
import { expectConsoleError } from '@/test/setup';

describe('Error boundary (app/error.tsx)', () => {
  // The boundary logs the error it is handling — that is its job, and the whole
  // point of these tests is to hand it one.
  beforeEach(() => {
    expectConsoleError('Unhandled application error:');
  });

  it('renders a branded fallback instead of the framework default', () => {
    render(<ErrorPage error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls reset when "Try again" is clicked', async () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error('boom')} reset={reset} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('offers a way back to the Dashboard', () => {
    render(<ErrorPage error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Go to Dashboard' })).toBeInTheDocument();
  });
});
