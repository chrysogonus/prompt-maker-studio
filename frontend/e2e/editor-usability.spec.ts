import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [1440, 390]) {
  test(`preserves draft, copying and version context at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    await page.goto('/library');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.locator('#username').fill(`ux${suffix}`);
    await page.locator('#password').fill('E2ePass123!');
    await page.locator('#reg-email').fill(`ux${suffix}@example.com`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Your prompt library is empty' })).toBeVisible();
    await page.route('**/api/prompts/config', (route) => route.fulfill({ json: {
      provider_connected: true, provider: 'ollama', provider_label: 'Ollama', model: 'test-model',
      available_models: [], budget_exhausted: false, global_budget_remaining_usd: null,
    } }));
    await page.goto('/editor/new?starter=role-task-format');
    await expect(page.getByLabel('Task text')).toHaveValue('');
    await expect(page.getByLabel('Task text')).toHaveAttribute('placeholder', /Explain.*topic/);
    await page.getByLabel('Role text').fill('Be precise.');
    await page.getByLabel('Task text').fill('Explain {{topic}}.');
    await page.getByLabel('Format text').fill('Use three bullets.');
    await page.getByText('Options for topic', { exact: true }).click();
    await page.getByLabel('Required topic', { exact: true }).check();
    await page.getByLabel('Example input for topic').fill('Saturn');

    const tools = page.getByRole('button', { name: /^(Move .* (up|down)|Remove (Role|Task|Format))$/ });
    for (const button of await tools.all()) {
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate((element) => getComputedStyle(element.parentElement!).opacity)).toBe('1');
    }
    await page.getByRole('button', { name: 'Move Task up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Section name').first()).toHaveValue('Task');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const save = page.getByRole('dialog', { name: 'Save prompt' });
    await save.getByLabel('Name', { exact: true }).fill('Isolated UX prompt');
    await save.getByRole('button', { name: 'Save prompt' }).click();
    await expect(page).toHaveURL(/\/editor\/\d+$/);
    const editorUrl = page.url();
    await page.reload();
    await expect(page.getByLabel('topic Required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy filled prompt' })).toBeDisabled();
    await page.getByLabel('topic Required').fill('   ');
    await expect(page.getByLabel('Prompt text')).toContainText('Explain {{topic}}.');
    await page.getByRole('button', { name: 'Copy with placeholders' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Explain {{topic}}.');
    await page.getByRole('button', { name: 'Load example inputs' }).click();
    await expect(page.getByLabel('topic Required')).toHaveValue('Saturn');
    await page.getByRole('button', { name: 'Copy filled prompt' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Explain Saturn.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('{{topic}}');
    await page.route('**/api/prompts/try', (route) => {
      expect(route.request().postDataJSON().text).toContain('Explain Saturn.');
      return route.fulfill({ json: { output_text: 'Saturn has rings.', provider: 'ollama', model: 'test-model' } });
    });
    await page.getByText('Test with AI', { exact: true }).click();
    await page.getByRole('button', { name: 'Try once' }).click();
    await expect(page.getByRole('region', { name: 'Try once output' })).toContainText('Saturn has rings.');
    await expect(page.getByRole('button', { name: 'Edit template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

    await page.goto('/library');
    await expect(page.getByRole('link', { name: 'Fill and copy' })).toBeVisible();
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    const card = page.getByRole('listitem').filter({ hasText: 'Isolated UX prompt' });
    await expect(card.getByRole('button', { name: 'Copy the Isolated UX prompt template' })).toBeVisible();
    await card.getByRole('link', { name: 'Fill and copy' }).click();
    await expect(page.getByLabel('topic Required')).toBeVisible();
    await expect(page).toHaveURL(/mode=filled/);
    await page.getByRole('button', { name: 'Edit template', exact: true }).click();

    await page.getByLabel('Task text').fill('Explain {{topic}} briefly.');
    await page.getByLabel('Version note').fill('Make it brief');
    await page.reload();
    await page.getByRole('button', { name: 'Edit template', exact: true }).click();
    await expect(page.getByText('Your unsaved changes were restored.')).toBeVisible();
    await expect(page.getByLabel('Task text')).toHaveValue('Explain {{topic}} briefly.');
    await expect(page.getByLabel('Version note')).toHaveValue('Make it brief');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByText('Version 2, current').locator('..')).toContainText('Make it brief');
    await page.getByRole('button', { name: 'Close history' }).click();
    await page.getByLabel('Task text').fill('Explain {{topic}} clearly.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('button', { name: /Version 2/ })).toContainText('Make it brief');
    await page.getByRole('button', { name: 'Close history' }).click();

    await page.route('**/api/prompts/parse-text', (route) => route.fulfill({ json: { fields: [{ name: 'Imported', content: 'Imported draft.' }] } }));
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Paste a prompt' }).click();
    const importer = page.getByRole('dialog', { name: 'Paste a prompt' });
    await expect(importer).toContainText('current draft stays as it is');
    await expect(importer).toContainText('Ollama / test-model');
    await importer.getByLabel('Prompt to convert').fill('Imported draft.');
    await importer.getByRole('button', { name: 'Create template with AI', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review your template' });
    await expect(review).toContainText('replace your current sections and variable settings');
    await review.getByRole('button', { name: 'Use in editor' }).click();
    if (width < 760) await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Imported text')).toHaveValue('Imported draft.');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('Task text')).toHaveValue('Explain {{topic}} clearly.');
    await expect(page.getByLabel('Example input for topic')).toHaveValue('Saturn');
    await expect(page.getByLabel('Required topic', { exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`), fullPage: true });
    await page.goto(editorUrl);
    await expect(page.getByLabel('topic Required')).toHaveValue('Saturn');
    await expect(page.getByText('Inputs stay on this device until you clear them.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Review your template' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear inputs', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('topic Required')).toHaveValue('');
  });
}
