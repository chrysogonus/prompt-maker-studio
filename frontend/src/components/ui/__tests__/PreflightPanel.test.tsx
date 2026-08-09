import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PreflightPanel from '../PreflightPanel';

describe('PreflightPanel', () => {
  it('renders nothing when there are no warnings', () => {
    const { container } = render(<PreflightPanel warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each warning message', () => {
    render(
      <PreflightPanel
        warnings={[
          { id: 'a', message: 'First warning', severity: 'warning' },
          { id: 'b', message: 'Second note', severity: 'info' },
        ]}
      />
    );
    expect(screen.getByText('First warning')).toBeInTheDocument();
    expect(screen.getByText('Second note')).toBeInTheDocument();
  });
});
