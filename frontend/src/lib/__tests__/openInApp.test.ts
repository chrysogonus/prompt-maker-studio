import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInApp, pendingHandoff } from '../openInApp';
import { pasteHandoffKey } from '../promptImport';

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('openInApp', () => {
  it('hands sections, inputs and hints to the editor draft and opens it', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/gallery/trip', assign });
    openInApp({ title: 'Trip', fields: [{ name: 'Task', content: 'Plan {{days}} days in {{city}}.' }], values: { days: '3' }, hints: { city: 'Where?' } });

    expect(assign).toHaveBeenCalledWith('/editor/new?import=1');
    expect(JSON.parse(sessionStorage.getItem(pasteHandoffKey())!)).toEqual({
      origin: 'handoff',
      title: 'Trip',
      returnTo: '/gallery/trip',
      fields: [{ name: 'Task', content: 'Plan {{days}} days in {{city}}.' }],
      values: { days: '3' },
      metadata: { days: { type: 'text', description: '' }, city: { type: 'text', description: 'Where?' } },
    });
    expect(pendingHandoff()).toMatchObject({ title: 'Trip', returnTo: '/gallery/trip' });
  });

  it('offers only a path on this site as the way back', () => {
    for (const returnTo of ['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example/x', 'javascript:alert(1)']) {
      sessionStorage.setItem(pasteHandoffKey(), JSON.stringify({ origin: 'handoff', fields: [], values: {}, metadata: {}, returnTo }));
      expect(pendingHandoff()?.returnTo, returnTo).toBe('');
    }
    sessionStorage.setItem(pasteHandoffKey(), JSON.stringify({ origin: 'handoff', fields: [], values: {}, metadata: {}, returnTo: '/gallery/trip' }));
    expect(pendingHandoff()?.returnTo).toBe('/gallery/trip');
    sessionStorage.setItem(pasteHandoffKey(), 'A plain library note');
    expect(pendingHandoff()).toBeNull();
  });

  it('splits sections over 10,000 characters so the draft can save them', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const long = `${'a'.repeat(6000)}\n\n${'b'.repeat(6000)}`;
    openInApp({ fields: [{ name: 'Task', content: long }] });

    const { fields } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(fields.map((field: { content: string }) => field.content.length)).toEqual([6000, 6000]);
  });

  it('keeps a variable that crosses the 10,000-character boundary', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    openInApp({ fields: [{ name: 'Task', content: `${'a'.repeat(9998)}{{topic}}` }] });

    const { fields, metadata } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(fields[1].content).toBe('{{topic}}');
    expect(Object.keys(metadata)).toEqual(['topic']);
  });

  it('hands over long text without splitting an emoji', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    openInApp({ fields: [{ name: 'Task', content: `${'a'.repeat(9999)}😀b` }] });

    const { fields } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(fields.map((field: { content: string }) => field.content)).toEqual(['a'.repeat(9999), '😀b']);
  });

  it('ignores inherited properties when reading values and hints', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    openInApp({ fields: [{ name: 'Task', content: 'Use {{constructor}}.' }] });

    const { values, metadata } = JSON.parse(sessionStorage.getItem(pasteHandoffKey())!);
    expect(values).toEqual({});
    expect(metadata.constructor).toEqual({ type: 'text', description: '' });
  });
});
