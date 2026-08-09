import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InputPanel from '../InputPanel';
import { PromptField } from '@/types/prompt';

function InputPanelHarness({ initialFields }: { initialFields: PromptField[] }) {
  const [fields, setFields] = useState(initialFields);

  return (
    <InputPanel
      fields={fields}
      onFieldsChange={setFields}
      onGenerate={vi.fn()}
      isLoading={false}
    />
  );
}

describe('InputPanel component', () => {
  it('sanitizes field names before storing them', async () => {
    const user = userEvent.setup();

    render(<InputPanelHarness initialFields={[{ name: '', content: '' }]} />);

    await user.type(screen.getByPlaceholderText(/field name/i), 'user name!');

    expect(screen.getByPlaceholderText(/field name/i)).toHaveValue('user_name');
  });

  it('blocks generation when sanitized field names are duplicated', () => {
    render(
      <InputPanel
        fields={[
          { name: 'goal', content: 'First' },
          { name: 'goal', content: 'Second' },
        ]}
        onFieldsChange={vi.fn()}
        onGenerate={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByRole('button', { name: /generate prompt/i })).toBeDisabled();
    expect(screen.getByText(/field names must be unique/i)).toBeInTheDocument();
  });

  it('blocks generation when field names differ only in case', () => {
    // Both names become the same `<QA_DUP>` tag, so the generated prompt would
    // contain two identical blocks — balanced, so preflight stays silent too.
    render(
      <InputPanel
        fields={[
          { name: 'QA_dup', content: 'first' },
          { name: 'qa_DUP', content: 'second' },
        ]}
        onFieldsChange={vi.fn()}
        onGenerate={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByRole('button', { name: /generate prompt/i })).toBeDisabled();
    expect(screen.getByText(/field names must be unique/i)).toBeInTheDocument();
  });

  it('fires onGenerate on Ctrl+Enter when form is valid', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();

    render(
      <InputPanel
        fields={[{ name: 'goal', content: 'Some content' }]}
        onFieldsChange={vi.fn()}
        onGenerate={onGenerate}
        isLoading={false}
      />
    );

    const textarea = screen.getAllByRole('textbox')[0];
    await user.click(textarea);
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not fire onGenerate on Ctrl+Enter when form is invalid', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();

    // Empty field name — form is invalid (canGenerate = false)
    render(
      <InputPanel
        fields={[{ name: '', content: '' }]}
        onFieldsChange={vi.fn()}
        onGenerate={onGenerate}
        isLoading={false}
      />
    );

    const textarea = screen.getAllByRole('textbox')[0];
    await user.click(textarea);
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('swaps a field with the next one when its down arrow is clicked', async () => {
    const user = userEvent.setup();

    render(
      <InputPanelHarness
        initialFields={[
          { name: 'first', content: 'First content' },
          { name: 'second', content: 'Second content' },
        ]}
      />
    );

    const downButtons = screen.getAllByTitle(/move field down/i);
    await user.click(downButtons[0]);

    const nameInputs = screen.getAllByPlaceholderText(/field name/i) as HTMLInputElement[];
    expect(nameInputs[0]).toHaveValue('second');
    expect(nameInputs[1]).toHaveValue('first');
  });

  it('swaps a field with the previous one when its up arrow is clicked', async () => {
    const user = userEvent.setup();

    render(
      <InputPanelHarness
        initialFields={[
          { name: 'first', content: 'First content' },
          { name: 'second', content: 'Second content' },
        ]}
      />
    );

    const upButtons = screen.getAllByTitle(/move field up/i);
    await user.click(upButtons[1]);

    const nameInputs = screen.getAllByPlaceholderText(/field name/i) as HTMLInputElement[];
    expect(nameInputs[0]).toHaveValue('second');
    expect(nameInputs[1]).toHaveValue('first');
  });

  it('loads a starter kit preset, replacing the current fields', async () => {
    const user = userEvent.setup();

    render(<InputPanelHarness initialFields={[{ name: '', content: '' }]} />);

    await user.selectOptions(screen.getByLabelText(/load starter kit/i), 'role-task-context');

    const nameInputs = screen.getAllByPlaceholderText(/field name/i) as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(['role', 'task', 'context']);
  });

  it('disables the up arrow on the first field and the down arrow on the last field', () => {
    render(
      <InputPanel
        fields={[
          { name: 'first', content: 'First content' },
          { name: 'second', content: 'Second content' },
          { name: 'third', content: 'Third content' },
        ]}
        onFieldsChange={vi.fn()}
        onGenerate={vi.fn()}
        isLoading={false}
      />
    );

    const upButtons = screen.getAllByTitle(/move field up/i);
    const downButtons = screen.getAllByTitle(/move field down/i);

    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
  });
});
