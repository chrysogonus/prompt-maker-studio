import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OutputPanel from '../OutputPanel';

describe('OutputPanel component', () => {
  it('compiles placeholders before copying', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <OutputPanel
        prompt="Hi {{user_name}}, [Insert text]"
        canSave={false}
        canUpdate={false}
      />
    );

    await user.type(screen.getByPlaceholderText('{{user_name}}'), 'Ada');
    await user.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(writeText).toHaveBeenCalledWith('Hi Ada, [Insert text]');
    expect(screen.getByRole('button', { name: '✓ Copied' })).toBeInTheDocument();
  });

  it('copies the raw template, placeholders intact, when Raw mode is selected', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <OutputPanel
        prompt="Hi {{user_name}}, [Insert text]"
        canSave={false}
        canUpdate={false}
      />
    );

    await user.type(screen.getByPlaceholderText('{{user_name}}'), 'Ada');
    await user.click(screen.getByRole('radio', { name: 'Raw' }));
    await user.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(writeText).toHaveBeenCalledWith('Hi {{user_name}}, [Insert text]');
  });

  it('shows metrics bar when a prompt is present', () => {
    render(
      <OutputPanel
        prompt="Hello world"
        canSave={false}
        canUpdate={false}
      />
    );

    // "Hello world" = 11 chars, 2 words, ~3 tokens
    expect(screen.getByText(/chars/i)).toBeInTheDocument();
    expect(screen.getByText(/words/i)).toBeInTheDocument();
    expect(screen.getByText(/tokens/i)).toBeInTheDocument();
  });

  it('hides metrics bar when no prompt is set', () => {
    render(
      <OutputPanel
        prompt=""
        canSave={false}
        canUpdate={false}
      />
    );

    expect(screen.queryByText(/chars/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
  });
});
