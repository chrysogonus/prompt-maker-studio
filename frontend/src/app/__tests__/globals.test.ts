import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const globalsCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function darkThemeColor(name: string): string {
  const darkTheme = globalsCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1];
  const value = darkTheme?.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`Missing dark-theme color token: --${name}`);
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

describe('dark theme accessibility tokens', () => {
  it('keeps muted text at WCAG AA contrast against canvas and panel backgrounds', () => {
    const muted = darkThemeColor('color-text-muted');

    expect(contrastRatio(muted, darkThemeColor('color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, darkThemeColor('color-panel'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('root layout stability', () => {
  it('reserves the scrollbar gutter across route transitions', () => {
    expect(globalsCss).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable;/);
  });
});
