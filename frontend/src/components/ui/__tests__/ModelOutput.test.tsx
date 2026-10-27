import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelOutput from '../ModelOutput';

const TABLE = '| Day | Morning |\n|---|---|\n| **1** | Market |';

describe('ModelOutput', () => {
  it('renders Markdown tables and emphasis, in a keyboard-scrollable region', () => {
    render(<ModelOutput text={TABLE} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByText('1').tagName).toBe('STRONG');
    expect(screen.getByRole('region', { name: 'Table' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: 'Model output' })).toHaveAttribute('tabindex', '0');
  });

  it('keeps untrusted HTML, scripts and images out and opens links apart from the app', () => {
    const { container } = render(<ModelOutput text={'<script>alert(1)</script><b onclick="x()">bold</b>\n\n![tracker](https://example.com/p.png)\n\n[site](https://example.com) [bad](javascript:alert(1))'} />);
    expect(container.querySelector('script, b, img')).toBeNull();
    expect(screen.getByText(/tracker/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('bad').closest('a')?.getAttribute('href') ?? '').not.toMatch(/javascript:/);
  });

  it('shows the exact text on request', async () => {
    const user = userEvent.setup();
    render(<ModelOutput text={TABLE} />);
    await user.click(screen.getByRole('button', { name: 'Plain text' }));
    expect(screen.getByRole('button', { name: 'Plain text' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Model output')).toHaveTextContent('| **1** | Market |');
  });
});
