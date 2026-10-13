import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';

// The Tasks page, the shared task table, and the task panel, at desktop and mobile widths.

/** Jan 19 only, so task 48213 is on the first page. */
const JAN_19 = '/tasks?from=2027-01-19&to=2027-01-19';

const row = (page: Page, taskId: number) => page.locator(`[data-task-id="${taskId}"]`);
const panel = (page: Page) => page.locator('g-task-panel');

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('opens a task from the list and shows how it was paired', async ({ page }) => {
  await page.goto(JAN_19);
  await row(page, 48213).click();
  await expect(page).toHaveURL(/task=48213/);

  const p = panel(page);
  await expect(p.getByRole('heading', { name: 'Task 48213' })).toBeFocused();
  await expect(p).toContainText('Chilled · Cycle count · Port 3 · Tue, Jan 19');
  await expect(p).toContainText('3:41');
  await expect(p).toContainText('Above P90 (2:08)');
  await expect(p).toContainText('SIMUSR0142');
  await expect(p).toContainText('From the start move');
  await expect(p).toContainText('SIMTU004417');

  const moves = p.locator('.moves li');
  await expect(moves).toHaveCount(4);
  await expect(moves.nth(0)).toContainText('18:41:07.302');
  await expect(moves.nth(0)).toContainText('Discarded');
  await expect(moves.nth(0)).toContainText('A later start on this bin arrived before the end.');
  await expect(moves.nth(0).locator('s')).toHaveText('18:41:07.302');
  await expect(moves.nth(1)).toContainText('Start');
  await expect(moves.nth(2)).toContainText('−1 (24 → 23)');
  await expect(moves.nth(3)).toContainText('No partner ID');
  await expect(moves.nth(3)).toContainText('End');
  await expect(p).toContainText('Duration = end − latest start on the same bin.');
  await expect(p).toContainText('the partner comes from the start.');
});

test('Esc closes the panel and returns focus to the row', async ({ page }) => {
  await page.goto(JAN_19);
  await row(page, 48213).click();
  await expect(panel(page).getByRole('heading', { name: 'Task 48213' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await expect(row(page, 48213)).toBeFocused();
});

test('the close control returns focus to the row', async ({ page }, info) => {
  await page.goto(JAN_19);
  await row(page, 48213).click();
  const name = info.project.name === 'mobile' ? 'Back to tasks' : 'Close task';
  await panel(page).getByRole('button', { name }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(row(page, 48213)).toBeFocused();
});

test('the open task survives reload, back, and forward', async ({ page }) => {
  await page.goto(JAN_19);
  await row(page, 48213).click();
  await expect(page).toHaveURL(/task=48213/);

  await page.reload();
  await expect(panel(page).getByRole('heading', { name: 'Task 48213' })).toBeVisible();
  await expect(row(page, 48213)).toHaveAttribute('aria-current', 'true');

  await page.goBack();
  await expect(page).not.toHaveURL(/task=/);
  await expect(panel(page)).toHaveCount(0);

  await page.goForward();
  await expect(page).toHaveURL(/task=48213/);
  await expect(panel(page).getByRole('heading', { name: 'Task 48213' })).toBeVisible();
});

test('the panel sits beside the list on desktop and covers the screen on mobile', async ({
  page,
}, info) => {
  await page.goto(`${JAN_19}&task=48213`);
  await expect(panel(page).getByRole('heading', { name: 'Task 48213' })).toBeVisible();
  const box = (await panel(page).boundingBox())!;
  if (info.project.name === 'mobile') {
    expect(box.x).toBe(0);
    expect(box.width).toBe(380);
  } else {
    expect(box.width).toBeCloseTo(390, 0);
    await expect(row(page, 48213)).toBeVisible();
  }
});

test('the Above P90 toggle filters the list and lives in the URL', async ({ page }) => {
  await page.goto('/tasks?page=1');
  await page.getByLabel('Above P90 only').check();
  await expect(page).toHaveURL(/aboveP90=true/);
  await expect(page).not.toHaveURL(/page=/);
  const rows = page.locator('[data-task-id]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  await expect(page.locator('g-task-table .pill', { hasText: 'Above P90' })).toHaveCount(count);

  await page.reload();
  await expect(page.getByLabel('Above P90 only')).toBeChecked();
});

test('pages through the list with the page in the URL', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByText('61 tasks · Page 1 of 3')).toBeVisible();
  await expect(page.locator('[data-task-id]')).toHaveCount(25);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=1/);
  await expect(page.getByText('61 tasks · Page 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('61 tasks · Page 3 of 3')).toBeVisible();
  await expect(page.locator('[data-task-id]')).toHaveCount(11);
  await page.goBack();
  await expect(page.getByText('61 tasks · Page 2 of 3')).toBeVisible();
});

test('shows skeleton rows while loading', async ({ page }) => {
  await page.goto('/tasks?mock=slow');
  await expect(page.locator('g-task-table .skeleton').first()).toBeVisible();
  await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 5000 });
});

test('shows the empty state with Clear filters', async ({ page }) => {
  await page.goto('/tasks?mock=empty&zone=CHILLED');
  await expect(page.getByText('No tasks match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/zone=/);
});

test('shows the error state with Try again', async ({ page }) => {
  await page.goto('/tasks?mock=error');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('an unknown task says so and offers a way back', async ({ page }) => {
  await page.goto('/tasks?task=1');
  await expect(page.getByText("We couldn't find task 1.")).toBeVisible();
  await panel(page).getByRole('button', { name: 'Back to tasks' }).last().click();
  await expect(page).not.toHaveURL(/task=/);
});

test('the partner filter shows as a removable chip', async ({ page }) => {
  await page.goto('/tasks');
  await page.getByLabel('Partner ID').fill('SIMUSR0142');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page).toHaveURL(/partnerId=SIMUSR0142/);
  await page.getByRole('button', { name: 'Remove partner filter SIMUSR0142' }).click();
  await expect(page).not.toHaveURL(/partnerId=/);
});

test('the list and the open panel have no serious or critical axe violations', async ({ page }) => {
  await page.goto(JAN_19);
  await expect(row(page, 48213)).toBeVisible();
  await expectNoSeriousViolations(page);

  await row(page, 48213).click();
  await expect(panel(page).locator('.moves li')).toHaveCount(4);
  await expectNoSeriousViolations(page);
});
