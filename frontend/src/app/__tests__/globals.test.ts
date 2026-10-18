import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const globalsCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function themeColor(theme: 'light' | 'dark', name: string): string {
  const block = globalsCss.match(theme === 'light' ? /:root\s*\{([\s\S]*?)\}/ : /\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1];
  const value = block?.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`Missing ${theme}-theme color token: --${name}`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left
  );
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

const SURFACES = ['color-canvas', 'color-panel', 'color-panel-raised', 'color-overlay', 'color-sidebar'];

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  const color = (name: string) => themeColor(theme, name);

  it.each(['color-text-primary', 'color-text-secondary', 'color-text-muted'])('keeps %s at 4.5:1 on every surface', (text) => {
    for (const surface of SURFACES) {
      expect(contrastRatio(color(text), color(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps form control edges at 3:1 on every surface, including selection and the preview', () => {
    for (const surface of [...SURFACES, 'color-plum-wash']) {
      expect(contrastRatio(color('color-control-border'), color(surface)), `control border on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    for (const surface of ['pv-bg', 'pv-input']) {
      expect(contrastRatio(color('pv-control-border'), color(surface)), `preview control border on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('native controls', () => {
  it('declares a color scheme for each theme', () => {
    expect(globalsCss).toMatch(/:root\s*\{[^}]*color-scheme:\s*light;/);
    expect(globalsCss).toMatch(/\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark;/);
  });
});

describe('root layout stability', () => {
  it('reserves the scrollbar gutter across route transitions', () => {
    expect(globalsCss).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable;/);
  });
});
