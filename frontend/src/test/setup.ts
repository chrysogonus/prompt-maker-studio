import '@testing-library/jest-dom';

import { afterEach, beforeEach, expect, vi } from 'vitest';

/**
 * Fail a test that logged an unexpected `console.error`, and mock the download
 * boundary jsdom cannot honour.
 *
 * A green suite that prints errors is worse than a red one: it trains everybody
 * to skim the output, so a genuine regression looks like the noise already
 * there. This suite was emitting two unattributed "Not implemented: navigation"
 * errors — jsdom's reaction to clicking a synthesised `<a download>`, raised
 * from a timer after the responsible test had finished.
 *
 * A test that deliberately provokes an error opts out with
 * `expectConsoleError(...)`.
 */
vi.mock('@/lib/download', () => ({
  downloadBlob: vi.fn(),
}));

/**
 * jsdom cannot navigate, and reports any attempt as an uncatchable error raised
 * from a timer — so it lands *after* the test that triggered it, unattributable
 * to anything. Clicking a Next `<Link>` is enough to cause it. Dropped here, once,
 * on an exact signature: this is a fixed limitation of the environment, not an
 * application error anyone can act on. Everything else still reaches the
 * per-test guard below.
 */
const JSDOM_NAVIGATION_NOTICE = 'Not implemented: navigation';

// The notice arrives as a `jsdomError` on jsdom's VirtualConsole, not through
// console.error, so it has to be filtered there. Other jsdomErrors are still
// forwarded — this drops one exact signature, not the channel.
interface VirtualConsoleLike {
  listeners(event: string): ((error: Error) => void)[];
  removeAllListeners(event: string): void;
  on(event: string, listener: (error: Error) => void): void;
}

const virtualConsole = (window as unknown as { _virtualConsole?: VirtualConsoleLike })
  ._virtualConsole;

if (virtualConsole) {
  const forward = virtualConsole.listeners('jsdomError').slice();
  virtualConsole.removeAllListeners('jsdomError');
  virtualConsole.on('jsdomError', (error: Error) => {
    if (String(error?.message ?? error).includes(JSDOM_NAVIGATION_NOTICE)) return;
    for (const listener of forward) listener(error);
  });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let allowedPatterns: (string | RegExp)[] = [];

/**
 * Permit `console.error` output matching these patterns for the current test.
 * Prefer a narrow pattern: a bare `/./` re-opens the hole this closes.
 */
export function expectConsoleError(...patterns: (string | RegExp)[]): void {
  allowedPatterns.push(...patterns);
}

function isAllowed(message: string): boolean {
  return allowedPatterns.some((pattern) =>
    typeof pattern === 'string' ? message.includes(pattern) : pattern.test(message),
  );
}

beforeEach(() => {
  allowedPatterns = [];
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const unexpected = consoleErrorSpy.mock.calls
    .map((args: unknown[]) => args.map((arg) => String(arg)).join(' '))
    .filter((message: string) => !isAllowed(message));

  consoleErrorSpy.mockRestore();

  expect(
    unexpected,
    `Unexpected console.error output:\n${unexpected.join('\n')}\n\n` +
      'Fix the cause, or allow it narrowly with expectConsoleError() from src/test/setup.',
  ).toEqual([]);
});
