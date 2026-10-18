import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const fields = [
  { name: 'Role', content: 'Write clear updates for busy stakeholders.' },
  { name: 'Context', content: 'Team: {{team}}\nWeek: {{week}}\nNotes: {{notes}}' },
  { name: 'Task', content: 'Lead with what shipped, then risks and next steps.' },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('prompt-maker-studio:client-session-expiry', String(Date.now() + 3_600_000)));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path === '/api/auth/me') json = { id: 1, username: 'alex', email: 'alex@example.com', created_at: '2026-10-01T10:00:00Z' };
    else if (path === '/api/auth/refresh') json = { expires_at: new Date(Date.now() + 3_600_000).toISOString() };
    else if (path === '/api/prompts/1') json = {
      id: 1, name: 'Weekly status update', fields, generated_prompt: '', folder: 'Work',
      created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
    };
    else if (path === '/api/prompts/config') json = {
      provider_connected: false, provider: null, provider_label: null, model: null,
      available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
    };
    else json = [];
    await route.fulfill({ json });
  });
});

test('keeps long library folder names inside the phone content area', async ({ page }) => {
  const folder = 'A long but valid folder name '.repeat(5).trim();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/prompts/saved', route => route.fulfill({ json: [{
    id: 1, name: 'Weekly status update', fields, generated_prompt: '', folder,
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  }] }));
  await page.goto('/library');
  const chip = page.getByRole('main').getByText(folder, { exact: true });
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('keeps every library grid card and action inside the list between breakpoints', async ({ page }) => {
  await page.route('**/api/prompts/saved', route => route.fulfill({ json: Array.from({ length: 4 }, (_, i) => ({
    id: i + 1, name: i % 2 ? 'Customer_support_reply_with_an_unbroken_name' : `Reply ${i + 1}`, fields, generated_prompt: '',
    folder: 'Customer support', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  })) }));
  await page.goto('/library');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  for (const width of [390, 481, 518, 600, 680, 760, 761, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const overflowing = await page.getByRole('main').locator('ul').first().evaluate(list => {
      const listRight = list.getBoundingClientRect().right + 0.5;
      return [...list.querySelectorAll('li, li a, li button')]
        .map(element => element.getBoundingClientRect().right)
        .filter(right => right > listRight)
        .map(Math.round);
    });
    expect(overflowing, `cards or controls past the list at ${width}px`).toEqual([]);
  }
});

for (const theme of ['light', 'dark']) {
  test(`keeps the sidebar in view while a long library scrolls in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.route('**/api/prompts/saved', route => route.fulfill({ json: Array.from({ length: 40 }, (_, i) => ({
      id: i + 1, name: `Prompt ${i + 1}`, fields, generated_prompt: '', folder: 'Work',
      created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
    })) }));
    await page.goto('/library');
    await expect(page.getByRole('main').getByText('Prompt 40')).toBeAttached();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const sidebar = (await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox())!;
    expect(sidebar.y).toBeGreaterThanOrEqual(0);
    expect(sidebar.y).toBeLessThanOrEqual(12);
  });
}

test('keeps the fill-in fields when Try once returns a long output', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/prompts/config', route => route.fulfill({ json: {
    provider_connected: true, provider: 'openai', provider_label: 'OpenAI', model: 'gpt-4.1-mini', uses_server_default: true,
    available_models: ['gpt-4.1-mini'], budget_exhausted: false, global_budget_remaining_usd: null,
  } }));
  await page.route('**/api/prompts/try', route => route.fulfill({ json: {
    output_text: Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long answer.`).join('\n'), provider: 'openai', model: 'gpt-4.1-mini',
  } }));
  await page.goto('/editor/1?mode=filled');
  const team = page.getByRole('textbox', { name: 'team' });
  await team.fill('Platform');
  // The fields' scroll area is what got squeezed, not the fields themselves.
  const inputsHeight = () => team.evaluate(el => el.closest('label')!.parentElement!.clientHeight);
  const before = await inputsHeight();
  await page.getByText('Test with AI', { exact: true }).click();
  await page.getByRole('button', { name: 'Try once', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Try once output' })).toBeVisible();
  expect(await inputsHeight()).toBeGreaterThanOrEqual(before);
});

for (const viewport of [{ width: 1440, height: 720 }, { width: 390, height: 844 }]) {
  test(`keeps New prompt full size with many folders at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/prompts/saved', route => route.fulfill({ json: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, name: `Prompt ${i + 1}`, fields, generated_prompt: '', folder: `Folder ${i + 1}`,
      created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
    })) }));
    await page.goto('/library');
    if (viewport.width <= 760) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('link', { name: /Folder 20/ })).toBeVisible();
    const button = (await page.getByRole('link', { name: 'New prompt', exact: true }).boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(36);
  });
}

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    test(`keeps the prompt and copy action in view at ${viewport.width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.goto('/editor/1?mode=filled');
      const preview = page.getByRole('complementary', { name: 'Preview', exact: true });
      await expect(preview).toBeVisible();
      const previewBox = (await preview.boundingBox())!;
      expect(previewBox.y).toBeLessThan(viewport.width > 760 ? 140 : 220);
      const textBox = (await page.getByLabel('Prompt text').boundingBox())!;
      expect(textBox.height).toBeGreaterThanOrEqual(160);
      const copyBox = (await page.getByRole('button', { name: 'Copy filled prompt' }).boundingBox())!;
      expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeFocused();
      await page.getByText('Test with AI', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'Try once', exact: true })).toBeDisabled();
      await expect(preview.getByText(/Connect an AI provider in Settings/)).toBeVisible();
      await page.getByText('Test with AI', { exact: true }).click();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`editor-${theme}-${viewport.width}.png`) });
    });
  }
}

for (const theme of ['light', 'dark']) {
  for (const width of [320, 768, 1024, 1280]) {
    test(`keeps editor sections and preview separate at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.goto('/editor/1');
      await page.getByRole('button', { name: 'Edit template', exact: true }).click();
      const edit = page.getByRole('tab', { name: 'Edit', exact: true });
      if (width <= 1200) await edit.click();
      await expect(page.getByLabel('Context text')).toBeVisible();
      // The editor was hidden behind Fill and copy; its text must not be cut to one line.
      await expect.poll(() => page.getByLabel('Context text').evaluate(el => el.clientHeight >= el.scrollHeight)).toBe(true);
      const preview = page.getByRole('complementary', { name: 'Preview', exact: true });
      if (width <= 1200) {
        await expect(preview).not.toBeVisible();
        await page.getByRole('tab', { name: 'Fill and copy' }).click();
        await expect(page.getByLabel('Context text')).not.toBeVisible();
        await expect(preview).toBeVisible();
      } else {
        const section = (await page.getByLabel('Context text').boundingBox())!;
        const pane = (await preview.boundingBox())!;
        expect(section.x + section.width).toBeLessThanOrEqual(pane.x);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

for (const width of [390, 1440]) {
  test(`saves pasted words without an AI call at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const text = '  Write a weekly update.\nKeep these spaces.  ';
    let saved: { name: string; fields: { name: string; content: string }[] } | undefined;
    let aiCalls = 0;
    await page.route('**/api/prompts/parse-text', route => { aiCalls++; return route.abort(); });
    await page.route('**/api/prompts', async route => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { id: 1, ...saved, created_at: '2026-10-01T10:00:00Z' } });
    });
    await page.goto('/editor/new?import=1');
    const paste = page.getByRole('dialog', { name: 'Paste a prompt', exact: true });
    await expect(paste).toContainText('copied output includes <TASK> section wrappers');
    await paste.getByLabel('Prompt to convert').fill(text);
    await paste.getByRole('button', { name: 'Save as written' }).click();
    const save = page.getByRole('dialog', { name: 'Save prompt', exact: true });
    await expect(save.getByLabel('Name', { exact: true })).toHaveValue('Write a weekly update.');
    await save.getByLabel('Name', { exact: true }).fill('My weekly update');
    await save.getByRole('button', { name: 'Save prompt', exact: true }).click();
    await expect(page).toHaveURL(/\/editor\/1$/);
    expect(saved).toMatchObject({ name: 'My weekly update', fields: [{ name: 'Task', content: text }] });
    expect(aiCalls).toBe(0);
  });
}

for (const width of [320, 390, 768, 1440]) {
  test(`keeps mode controls, plain output and prompt details usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/editor/1');
    await page.getByRole('button', { name: 'Edit template', exact: true }).click();
    const useButton = page.getByRole('button', { name: 'Fill and copy', exact: true });
    const useTab = page.getByRole('tab', { name: 'Fill and copy', exact: true });
    if (width <= 1200) {
      await expect(useButton).not.toBeVisible();
      await expect(useTab).toBeVisible();
      expect((await useTab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await useTab.click();
    } else await useButton.click();
    await page.getByText('Output options', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Output format' }).selectOption('plain');
    await expect(page.getByLabel('Prompt text')).toHaveText('Write clear updates for busy stakeholders.\n\nTeam: {{team}}\nWeek: {{week}}\nNotes: {{notes}}\n\nLead with what shipped, then risks and next steps.');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Prompt details' }).click();
    const details = page.getByRole('dialog', { name: 'Prompt details' });
    await expect(details).toContainText('Weekly status update');
    await expect(details).toContainText('Work');
    expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
