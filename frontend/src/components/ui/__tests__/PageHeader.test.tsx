import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from '../PageHeader';

describe('PageHeader', () => {
  it('renders a title with optional description and actions', () => {
    render(
      <PageHeader
        title="Prompt library"
        description="Manage saved prompts."
        actions={<button type="button">New prompt</button>}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Prompt library' })).toBeInTheDocument();
    expect(screen.getByText('Manage saved prompts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New prompt' })).toBeInTheDocument();
  });

  it('does not add empty description or action containers', () => {
    const { container } = render(<PageHeader title="New prompt" />);

    expect(screen.getByRole('heading', { level: 1, name: 'New prompt' })).toBeInTheDocument();
    expect(container.querySelectorAll('div')).toHaveLength(2);
  });
});
