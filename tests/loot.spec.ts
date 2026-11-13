import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test } from './browser-fixture';

test.beforeEach(async ({ page }) => { await page.addScriptTag({ content: await readFile('tests/loot-fixture.js', 'utf8') }); });
async function enable(page: Page): Promise<void> { await page.getByRole('button', { name: '啟用自動選牌', exact: true }).click(); }
async function loot(page: Page, options: Record<string, unknown> = {}): Promise<void> { await page.evaluate(options => (window as any).showLoot(options), options); }
async function taken(page: Page): Promise<string[]> { return page.evaluate(() => (window as any).lootTaken); }

test('loot previews, then gets consecutive identical equipment after the animation lock', async ({ page }) => {
  await loot(page, { next: {} });
  await page.waitForTimeout(1500); expect(await taken(page)).toEqual([]);
  await enable(page);
  await expect.poll(() => taken(page), { timeout: 6500 }).toEqual(['測試裝備', '測試裝備']);
  const clicks = await page.evaluate(() => (window as any).lootClicks);
  expect(clicks).toHaveLength(2); expect(clicks.every((c: any) => c.elapsed >= 750 && c.target === 'dr-get')).toBe(true);
  await expect(page.locator('#logs')).toContainText('已點擊取得');
});

test('pausing and disabling automatic loot both cancel a queued acquisition', async ({ page }) => {
  await enable(page); await loot(page);
  await expect(page.locator('#status')).toContainText('即將取得');
  await page.getByRole('button', { name: '暫停自動選牌', exact: true }).click();
  await page.waitForTimeout(1700); expect(await taken(page)).toEqual([]);
  await page.locator('#advanced summary').click(); await page.locator('#auto-collect-loot').uncheck(); await enable(page);
  await page.waitForTimeout(1700); expect(await taken(page)).toEqual([]);
  await page.locator('#auto-collect-loot').check();
  await expect.poll(() => taken(page)).toEqual(['測試裝備']);
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click(); await page.locator('#advanced summary').click();
  await expect(page.locator('#auto-collect-loot')).toBeChecked();
});

test('group rolls, continue buttons and other rewards remain manual', async ({ page }) => {
  await enable(page);
  for (const options of [{ roll: true }, { label: '繼續' }, { badge: '卡片' }, { badge: '未知' }, { disabled: true }]) {
    await loot(page, options); await expect(page.locator('#status')).toContainText('保留手動');
    await page.waitForTimeout(1000);
  }
  expect(await taken(page)).toEqual([]);
  expect(await page.evaluate(() => (window as any).lootClicks)).toEqual([]);
});

test('rejected acquisition pauses instead of repeatedly clicking get', async ({ page }) => {
  await enable(page); await loot(page, { reject: true });
  await expect(page.locator('#status')).toContainText('遊戲未確認裝備取得', { timeout: 6000 });
  expect(await page.evaluate(() => (window as any).lootClicks.length)).toBe(1);
  await expect(page.locator('#mode')).toContainText('PREVIEW');
});

test('equipment popup blocks queued card clicks until get closes it', async ({ page }) => {
  await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).fill('A'); await page.locator('#add-form button').click();
  await enable(page); await loot(page);
  await page.evaluate(() => (window as any).showRound({ cards: [{ name: 'A' }] }));
  await expect(page.locator('#status')).toContainText('取得');
  expect(await page.evaluate(() => (window as any).clickAttempts)).toEqual([]);
  await expect.poll(() => taken(page)).toEqual(['測試裝備']);
  await expect.poll(() => page.evaluate(() => (window as any).selections[0]?.name)).toBe('A');
});

test('manual get does not produce a duplicate automatic click', async ({ page }) => {
  await page.locator('#advanced summary').click(); await page.locator('#delay-min').fill('3000'); await page.locator('#delay-min').blur();
  await enable(page); await loot(page); await page.waitForTimeout(800);
  await page.locator('#drop-reveal .dr-get').click();
  await page.waitForTimeout(3200);
  expect(await taken(page)).toEqual(['測試裝備']);
  expect(await page.evaluate(() => (window as any).lootClicks.length)).toBe(1);
});

test('background prevents loot acquisition until the game tab is visible again', async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  const contexts: { id: number; name: string; origin: string; auxData?: { isDefault?: boolean } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context)); await session.send('Runtime.enable');
  const isolated = contexts.find(context => !context.auxData?.isDefault && (context.origin.startsWith('chrome-extension://') || context.name.startsWith('chrome-extension://')))!;
  expect(isolated).toBeTruthy();
  const visibility = async (value: string) => { await session.send('Runtime.evaluate', { contextId: isolated.id, expression: `Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'${value}'});document.dispatchEvent(new Event('visibilitychange'));` }); };
  await enable(page); await visibility('hidden'); await loot(page);
  await expect(page.locator('#status')).toContainText('分頁在背景');
  await page.waitForTimeout(1800); expect(await taken(page)).toEqual([]);
  await visibility('visible'); await expect.poll(() => taken(page)).toEqual(['測試裝備']); await session.detach();
});
