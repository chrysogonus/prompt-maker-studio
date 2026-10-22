import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInApp } from '../openInApp';
import { pasteHandoffKey } from '../promptImport';

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('openInApp', () => {
  it('hands sections and inputs to the editor review and opens it', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    openInApp({ title: 'Trip', fields: [{ name: 'Task', content: 'Plan {{days}} days in {{city}}.' }], values: { days: '3' }, hints: { city: 'Where?' } });

    expect(assign).toHaveBeenCalledWith('/editor/new?import=1');
    const session = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(session).toMatchObject({
      text: '<TASK>\nPlan {{days}} days in {{city}}.\n</TASK>',
      title: 'Trip',
      conversion: { fields: [{ name: 'Task', content: 'Plan {{days}} days in {{city}}.' }] },
      reviewing: true,
      keepExamples: false,
    });
    expect(session.variables).toEqual([
      { name: 'days', originalName: 'days', reuse: true, value: '3', description: '', source_text: null },
      { name: 'city', originalName: 'city', reuse: true, value: '', description: 'Where?', source_text: null },
    ]);
  });

  it('splits sections over 10,000 characters so the review can save them', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const long = `${'a'.repeat(6000)}\n\n${'b'.repeat(6000)}`;
    openInApp({ fields: [{ name: 'Task', content: long }] });

    const { conversion } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(conversion.fields.map((field: { content: string }) => field.content.length)).toEqual([6000, 6000]);
    expect(conversion.fields.every((field: { content: string }) => field.content.length <= 10_000)).toBe(true);
  });

  it('keeps a variable that crosses the 10,000-character boundary', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    openInApp({ fields: [{ name: 'Task', content: `${'a'.repeat(9998)}{{topic}}` }] });

    const { conversion, variables } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(conversion.fields[1].content).toBe('{{topic}}');
    expect(variables.map((variable: { name: string }) => variable.name)).toEqual(['topic']);
  });

  it('hands over long text without splitting an emoji', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    openInApp({ fields: [{ name: 'Task', content: `${'a'.repeat(9999)}😀b` }] });

    const { conversion } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(conversion.fields.map((field: { content: string }) => field.content)).toEqual(['a'.repeat(9999), '😀b']);
  });

  it('ignores inherited properties when reading values and hints', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    openInApp({ fields: [{ name: 'Task', content: 'Use {{constructor}}.' }] });

    const { variables } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(variables[0]).toMatchObject({ name: 'constructor', value: '', description: '' });
  });
});
