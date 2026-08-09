import { expect, test, type Page } from '@playwright/test';

/**
 * The Content-Security-Policy is served by Caddy in production (see Caddyfile).
 *
 * These tests watch for real browser violations rather than only asserting on
 * header text: a policy that parses but blocks the app's own scripts leaves a
 * blank page and a passing header assertion. That is not hypothetical — it is
 * what happened when a nonce-based policy was tried here, because every page is
 * statically prerendered and so cannot carry a per-response nonce.
 *
 * Note that the E2E stack runs without Caddy, so the app is reached directly and
 * carries no CSP. The header assertions therefore run against the Caddyfile
 * itself; the violation watch runs against the live app and would catch a policy
 * that breaks it once Caddy is in front.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CADDYFILE = readFileSync(join(__dirname, '..', '..', 'Caddyfile'), 'utf8');

/** The app-facing policy: the first Content-Security-Policy outside the /api block. */
function appPolicy(): string {
  const match = /Content-Security-Policy "([^"]+)"/.exec(CADDYFILE);
  if (!match) throw new Error('no Content-Security-Policy found in the Caddyfile');
  return match[1];
}

function directive(policy: string, name: string): string {
  return policy.split(';').find((part) => part.trim().startsWith(name))?.trim() ?? '';
}

interface TestUser {
  username: string;
  password: string;
  email: string;
}

function uniqueUser(prefix: string): TestUser {
  const suffix = String(Date.now()) + String(Math.floor(Math.random() * 10_000));
  return {
    username: prefix + suffix,
    password: 'E2ePass123!',
    email: prefix + suffix + '@example.com',
  };
}

function watchForViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (?:execute|load|evaluate)/i.test(text)) {
      violations.push(text);
    }
  });
  page.on('pageerror', (error) => {
    if (/Content Security Policy/i.test(error.message)) violations.push(error.message);
  });
  return violations;
}

test.describe('Content-Security-Policy', () => {
  test('forbids eval and plugin content, and locks down the document base', () => {
    const policy = appPolicy();

    // 'unsafe-eval' allowed an injected payload to build code from a string. A
    // production build needs none of it.
    expect(policy).not.toContain("'unsafe-eval'");
    expect(directive(policy, 'object-src')).toContain("'none'");
    expect(directive(policy, 'base-uri')).toContain("'self'");
    expect(directive(policy, 'frame-ancestors')).toContain("'none'");
    expect(directive(policy, 'form-action')).toContain("'self'");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  test('documents the one remaining script-src allowance', () => {
    const scriptSrc = directive(appPolicy(), 'script-src');

    // Deliberate and known: Next streams flight data as inline <script> blocks
    // whose contents vary per page and per build, so neither `'self'` alone nor
    // build-time hashes work, and a nonce would require abandoning static
    // prerendering. If this assertion ever fails because 'unsafe-inline' is
    // gone, delete this test — the exposure it records has been closed.
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");
  });

  test('the API responses allow nothing to load at all', () => {
    const policies = [...CADDYFILE.matchAll(/Content-Security-Policy "([^"]+)"/g)].map((m) => m[1]);
    const apiPolicy = policies.find((policy) => policy.includes("default-src 'none'"));

    expect(apiPolicy, 'the /api handler should set its own restrictive policy').toBeTruthy();
    expect(apiPolicy).toContain("base-uri 'none'");
  });

  test('the app loads, hydrates, and navigates with no CSP violations', async ({ page }) => {
    const violations = watchForViolations(page);
    const user = uniqueUser('csp');

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await page.getByRole('button', { name: 'Create account' }).click();
    await page.locator('#username').fill(user.username);
    await page.locator('#password').fill(user.password);
    await page.locator('#reg-email').fill(user.email);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(`Good to see you, ${user.username}`)).toBeVisible();

    await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL(/\/library$/);

    expect(violations, `CSP violations:\n${violations.join('\n')}`).toEqual([]);
  });
});
