import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The overview page against the mock fixtures. Runs in both the desktop and mobile projects.

const summary = (page: Page) => page.locator('g-overview-summary');
const grid = (page: Page) => page.locator('g-median-grid');
const weekday = (page: Page) => page.locator('g-weekday-chart');

test('shows the fixture numbers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(summary(page)).toContainText('31,292');
  await expect(summary(page)).toContainText('from 80,000 rows');
  await expect(summary(page)).toContainText('1,118');
  await expect(summary(page)).toContainText('28 operating days');
  await expect(summary(page)).toContainText('58.4');
  await expect(summary(page)).toContainText('214');
  await expect(summary(page)).not.toContainText('no partner ID');

  const ambientCycle = grid(page).getByRole('link', { name: /Ambient cycle count/ });
  await expect(ambientCycle).toContainText('0:48');
  await expect(ambientCycle).toContainText('8,419');
  await expect(ambientCycle).toContainText('P90 1:52');
  await expect(weekday(page)).toContainText('Average per operating day');
});

test('the grid sits beside the chart on desktop and stacks on mobile', async ({ page }, info) => {
  await page.goto('/');
  await expect(grid(page).locator('table.grid')).toBeVisible();
  const g = (await grid(page).boundingBox())!;
  const w = (await weekday(page).boundingBox())!;
  const cards = (await summary(page).boundingBox())!;
  expect(g.y).toBeGreaterThanOrEqual(cards.y + cards.height);

  if (info.project.name === 'desktop') {
    expect(Math.abs(g.y - w.y)).toBeLessThan(2);
    expect(w.x).toBeGreaterThan(g.x + g.width);
    const share = g.width / (g.width + w.width);
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.65);
  } else {
    expect(w.y).toBeGreaterThanOrEqual(g.y + g.height);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a grid cell opens its tasks with the current dates', async ({ page }) => {
  await page.goto('/?from=2027-01-10&to=2027-01-20');
  await grid(page)
    .getByRole('link', { name: /Chilled bin maintenance/ })
    .click();
  await expect(page).toHaveURL(
    /\/tasks\?from=2027-01-10&to=2027-01-20&zone=CHILLED&taskType=BIN_MAINTENANCE$/,
  );
});

test('a filtered-out cell shows a dash instead of a link', async ({ page }) => {
  await page.goto('/?zone=CHILLED');
  await expect(grid(page).getByRole('link')).toHaveCount(2);
  await expect(grid(page).getByText('Not in these filters')).toHaveCount(2);
});

test('the Tasks / Hours toggle switches values and survives reload', async ({ page }) => {
  await page.goto('/');
  const tasks = weekday(page).getByRole('button', { name: 'Tasks' });
  const hours = weekday(page).getByRole('button', { name: 'Hours' });
  await expect(tasks).toHaveAttribute('aria-pressed', 'true');
  await expect(weekday(page)).toContainText('1,243');

  await hours.click();
  await expect(page).toHaveURL(/weekday=hours/);
  await expect(hours).toHaveAttribute('aria-pressed', 'true');
  await expect(weekday(page)).toContainText('65.0');
  await expect(weekday(page)).not.toContainText('1,243');

  await page.reload();
  await expect(hours).toHaveAttribute('aria-pressed', 'true');
  await expect(weekday(page)).toContainText('65.0');

  await tasks.click();
  await expect(page).not.toHaveURL(/weekday=/);
  await expect(weekday(page)).toContainText('1,243');
});

test('shows skeletons while loading', async ({ page }) => {
  await page.goto('/?mock=slow');
  await expect(summary(page).locator('[aria-busy="true"]')).toBeVisible();
  await expect(grid(page).locator('[aria-busy="true"]')).toBeVisible();
  await expect(weekday(page).locator('[aria-busy="true"]')).toBeVisible();
  await expect(summary(page)).toContainText('31,292', { timeout: 5000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('shows the empty state in each region and clears the filters', async ({ page }) => {
  await page.goto('/?mock=empty&zone=AMBIENT');
  for (const region of [summary(page), grid(page), weekday(page)]) {
    await expect(region).toContainText('No tasks in this range.');
  }
  await grid(page).getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/zone=/);
  await expect(page).toHaveURL(/mock=empty/);
});

test('shows the error state in each region with a retry', async ({ page }) => {
  await page.goto('/?mock=error');
  for (const region of [summary(page), grid(page), weekday(page)]) {
    await expect(region.getByRole('button', { name: 'Try again' })).toBeVisible();
  }
});

test('keyboard: Tab from the filter bar reaches a grid cell and Enter opens it', async ({
  page,
}) => {
  await page.goto('/');
  await expect(grid(page).locator('table.grid')).toBeVisible();
  const filters = page.getByRole('group', { name: 'Filters' });
  const controls = filters.locator('button:visible, select:visible, input:visible');
  await controls.last().focus();

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    const inCell = await page.evaluate(
      () => document.activeElement?.classList.contains('cell-link') ?? false,
    );
    if (inCell) break;
  }
  const focused = page.locator('a.cell-link:focus');
  await expect(focused).toHaveAccessibleName(/Ambient cycle count/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tasks\?zone=AMBIENT&taskType=CYCLE_COUNT$/);
});

test('has no serious or critical axe violations', async ({ page }) => {
  for (const url of ['/', '/?weekday=hours&zone=CHILLED', '/?mock=empty', '/?mock=error']) {
    await page.goto(url);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    expect(serious.map((v) => `${url} ${v.id}: ${v.help}`)).toEqual([]);
  }
});
