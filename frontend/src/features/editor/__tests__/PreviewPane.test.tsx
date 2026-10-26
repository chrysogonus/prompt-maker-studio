import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PreviewPane from '../PreviewPane';

const names = ['constructor', 'toString', '__proto__'];

function renderFilled(values: Record<string, string>) {
  return render(
    <PreviewPane
      fields={[{ name: 'Task', content: 'Use {{constructor}}, {{toString}} and {{__proto__}}.' }]}
      aiConfig={null}
      onLoadExamples={vi.fn()}
      onClearValues={vi.fn()}
      variables={names}
      metadata={{}}
      values={values}
      onValueChange={vi.fn()}
      mode="filled"
      onModeChange={vi.fn()}
      open
      onToggle={vi.fn()}
      onCopyFailed={vi.fn()}
    />,
  );
}

describe('PreviewPane', () => {
  it('treats variable names an object would inherit as unfilled', () => {
    renderFilled({});
    expect(screen.getByLabelText('Prompt text')).toHaveTextContent('Use {{constructor}}, {{toString}} and {{__proto__}}.');
    for (const name of names) expect(screen.getByRole('textbox', { name })).toHaveValue('');
    expect(screen.getByText('3 optional variables are not filled in.', { exact: false })).toBeInTheDocument();
  });

  it('fills variable names an object would inherit', () => {
    renderFilled(Object.fromEntries([['__proto__', 'x'], ['constructor', 'y']]));
    expect(screen.getByLabelText('Prompt text')).toHaveTextContent('Use y, {{toString}} and x.');
  });
});
