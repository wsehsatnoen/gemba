import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';

// The partner list and partner detail pages, in mock mode. The task table and task panel
// belong to the tasks spec; here we only check they're on the page.

const partnerLink = (page: Page, id: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(id) });

test.describe('partner list', () => {
  test('search filters the list and survives reload', async ({ page }) => {
    await page.goto('/partners');
    await expect(partnerLink(page, 'SIMUSR0118')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search partners' }).fill('0142');
    await expect(page).toHaveURL(/[?&]q=0142/);
    await expect(partnerLink(page, 'SIMUSR0142')).toBeVisible();
    await expect(partnerLink(page, 'SIMUSR0118')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search partners' })).toHaveValue('0142');
    await expect(partnerLink(page, 'SIMUSR0142')).toBeVisible();
    await expect(partnerLink(page, 'SIMUSR0118')).toHaveCount(0);
  });

  test('a row opens the partner with the filters kept', async ({ page }) => {
    await page.goto('/partners?zone=AMBIENT&taskType=CYCLE_COUNT');
    await partnerLink(page, 'SIMUSR0142').click();
    await expect(page).toHaveURL(/\/partners\/SIMUSR0142\?zone=AMBIENT&taskType=CYCLE_COUNT$/);
    await expect(page.getByRole('heading', { level: 1, name: 'SIMUSR0142' })).toBeVisible();
  });

  test('a search with no match names the search and offers to clear it', async ({ page }) => {
    await page.goto('/partners?q=nobody');
    await expect(page.getByText('No partners match “nobody”.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(partnerLink(page, 'SIMUSR0118')).toBeVisible();
  });

  test('loading, empty, and error states', async ({ page }) => {
    await page.goto('/partners?mock=slow');
    await expect(page.locator('.skeleton-rows .skeleton').first()).toBeVisible();
    await expect(partnerLink(page, 'SIMUSR0118')).toBeVisible();

    await page.goto('/partners?mock=empty');
    await expect(page.getByText('No partners match these filters.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await page.goto('/partners?mock=error');
    await expect(page.getByText('The mock server failed on purpose')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('partner detail', () => {
  test('header numbers and comparison tiles', async ({ page }) => {
    await page.goto('/partners/SIMUSR0142');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'SIMUSR0142' })).toBeVisible();
    await expect(main).toContainText(
      /612 tasks\s*·\s*18 days worked\s*·\s*median gap between tasks 0:21 \(facility 0:19\)/,
    );
    await expect(main.locator('.pace-value')).toHaveText('106%');
    await expect(main.getByText('pace vs facility')).toBeVisible();

    const tiles = main.locator('g-comparison-tiles li');
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText('Ambient cycle count');
    await expect(tiles.nth(0)).toContainText('112%');
    await expect(tiles.nth(1)).toContainText('95%');
    await expect(tiles.nth(2)).toContainText('111%');
    await expect(tiles.nth(3)).toContainText('Too few');
    await expect(tiles.nth(3)).toContainText('Needs 20 tasks');
    await expect(main).toContainText('gray under 20 tasks.');
  });

  test('selecting a day by keyboard filters the tasks, and the chip removes it', async ({
    page,
  }) => {
    await page.goto('/partners/SIMUSR0142');
    const chart = page.getByLabel('Daily pace for SIMUSR0142');
    const point = chart.getByRole('button', { name: /Jan 19/ });
    await point.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/day=2027-01-19/);

    const chip = page.getByRole('button', { name: 'Remove day filter Jan 19' });
    await expect(chip).toBeVisible();
    await expect(page.getByText('2 above P90')).toBeVisible();
    await expect(page.locator('g-task-table')).toBeVisible();

    await chip.click();
    await expect(page).not.toHaveURL(/day=/);
    await expect(chip).toHaveCount(0);
    await expect(page.getByText('above P90')).toHaveCount(0);
  });

  test('an open task gets a panel column beside the content on desktop', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'The panel is full screen on mobile.');
    await page.goto('/partners/SIMUSR0142?day=2027-01-19&task=48213');
    const content = await page.locator('g-partner-detail-page .content').boundingBox();
    const panel = await page.locator('g-partner-detail-page .panel').boundingBox();
    expect(content && panel).toBeTruthy();
    expect(panel!.x).toBeGreaterThanOrEqual(content!.x + content!.width);
    expect(panel!.width).toBeGreaterThan(350);
    expect(panel!.width).toBeLessThan(420);
    await expect(page.locator('g-task-panel')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'SIMUSR0142' })).toBeVisible();
  });

  test('an unknown partner shows a not-found message with a link back', async ({ page }) => {
    await page.goto('/partners/SIMUSR9999?zone=CHILLED');
    await expect(
      page.getByRole('heading', { level: 1, name: "We couldn't find partner SIMUSR9999." }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to partners' }).click();
    await expect(page).toHaveURL(/\/partners\?zone=CHILLED$/);
  });

  test('loading, empty, and error states', async ({ page }) => {
    await page.goto('/partners/SIMUSR0142?mock=slow');
    await expect(page.locator('.tile-skeletons .skeleton').first()).toBeVisible();
    await expect(page.locator('.chart-skeleton')).toBeVisible();
    await expect(page.getByText('pace vs facility')).toBeVisible();

    await page.goto('/partners/SIMUSR0142?mock=empty');
    await expect(
      page.getByText('No zone and task type comparisons match these filters.'),
    ).toBeVisible();
    await expect(page.getByText('No days worked match these filters.')).toBeVisible();

    await page.goto('/partners/SIMUSR0142?mock=error');
    // The header, tiles, and chart each have their own error (the task table has its own too).
    for (const path of ['SIMUSR0142.', 'SIMUSR0142/comparison.', 'SIMUSR0142/daily.']) {
      await expect(page.getByText(`failed on purpose for /api/partners/${path}`)).toBeVisible();
    }
  });
});

test.describe('accessibility', () => {
  for (const path of [
    '/partners',
    '/partners/SIMUSR0142',
    '/partners/SIMUSR0142?day=2027-01-19&task=48213',
    '/partners/SIMUSR9999',
  ]) {
    test(`${path} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }
});
