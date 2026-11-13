import { expect } from '@playwright/test';
import { test } from './browser-fixture';

test('fills only listed skills, takes listed orange first, then resumes normal upgrade priority', async ({ page }) => {
  test.setTimeout(35000);
  for (const name of ['A', 'B', 'C', 'D']) {
    await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).fill(name); await page.locator('#add-form button').click();
  }
  await expect(page.locator('#priority-help')).toContainText('橘色優先');
  await page.getByRole('button', { name: '取得後放逐 C', exact: true }).click();
  const cases = [
    { cards: [{ name: 'A' }, { name: 'B', badge: '史詩' }, { name: 'C', fresh: true }], pick: 'C' },
    { cards: [{ name: 'A' }, { name: 'B', badge: '傳說' }, { name: 'D', fresh: true }], pick: 'B' },
    { cards: [{ name: 'A' }, { name: 'B', badge: '史詩' }, { name: 'D', fresh: true }], pick: 'D' },
    { cards: [{ name: 'A' }, { name: 'B', badge: '史詩' }, { name: 'C', badge: '傳說' }], pick: 'A' },
    { cards: [{ name: 'Outside', badge: '傳說' }, { name: 'Outside new', fresh: true }, { name: 'A' }], pick: 'A' },
    { cards: [{ name: 'B', badge: '傳說' }, { name: 'A', badge: '傳說' }], pick: 'A' },
  ];
  await page.getByRole('checkbox', { name: '自動選牌', exact: true }).check();
  for (const [i, value] of cases.entries()) {
    await page.evaluate(cards => (window as any).showRound({ cards }), value.cards);
    await expect.poll(() => page.evaluate(i => (window as any).selections[i]?.name, i)).toBe(value.pick);
    await expect(page.locator('#picker')).toHaveClass(/hidden/);
  }
});

test('new skill priority can be disabled, saved and switched while a selection is pending', async ({ page }) => {
  for (const name of ['A', 'B']) {
    await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).fill(name); await page.locator('#add-form button').click();
  }
  await expect(page.locator('#prefer-new-skills')).toBeChecked();
  await page.evaluate(() => (window as any).showRound({ cards: [{ name: 'A' }, { name: 'B', fresh: true }] }));
  await expect(page.locator('.pk-card[data-ro-recommended="true"] .pk-name')).toHaveText('B');
  await page.getByRole('checkbox', { name: '自動選牌', exact: true }).check();
  await page.locator('#prefer-new-skills').uncheck();
  await expect.poll(() => page.evaluate(() => (window as any).selections[0]?.name)).toBe('A');
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await expect(page.locator('#prefer-new-skills')).not.toBeChecked();
});
