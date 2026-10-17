import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Foundation checks for the app shell. Feature pages add their own spec files.

test('every page shows the top bar, the synthetic data badge, and the filter bar', async ({
  page,
}) => {
  for (const path of ['/', '/partners', '/partners/SIMUSR0142', '/tasks']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'gemba', exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic data', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible();
  }
});

test('filters live in the URL and survive reload, back, and forward', async ({ page }, info) => {
  await page.goto('/tasks');
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: /Zone:/ }).click();
  }
  await page.getByLabel('Zone').selectOption('CHILLED');
  await expect(page).toHaveURL(/zone=CHILLED/);

  await page.reload();
  if (info.project.name === 'mobile') {
    await expect(page.getByRole('button', { name: 'Zone: Chilled' })).toBeVisible();
  } else {
    await expect(page.locator('#filter-zone')).toHaveValue('CHILLED');
  }
  await expect(page).toHaveURL(/zone=CHILLED/);

  await page.goBack();
  await expect(page).not.toHaveURL(/zone=/);
  await page.goForward();
  await expect(page).toHaveURL(/zone=CHILLED/);
});

test('nav links keep the filters', async ({ page }) => {
  await page.goto('/?zone=AMBIENT&taskType=CYCLE_COUNT');
  const tasks = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' });
  // The links pick up the filters when the first navigation ends; wait for that before clicking.
  await expect(tasks).toHaveAttribute('href', /zone=AMBIENT/);
  await tasks.click();
  await expect(page).toHaveURL(/\/tasks\?zone=AMBIENT&taskType=CYCLE_COUNT/);
});

test('an invalid filter falls back to its default with a notice', async ({ page }) => {
  await page.goto('/tasks?zone=FROZEN');
  await expect(page.getByRole('status')).toContainText('defaults are shown for: zone');
});

test('the shell has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('no horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
