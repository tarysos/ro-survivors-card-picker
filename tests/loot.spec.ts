import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test } from './browser-fixture';

test.beforeEach(async ({ page }) => { await page.addScriptTag({ content: await readFile('tests/loot-fixture.js', 'utf8') }); });
async function enable(page: Page): Promise<void> { await page.getByRole('checkbox', { name: '自動選牌', exact: true }).check(); }
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

test('pausing and disabling automatic loot both cancel a queued card acquisition', async ({ page }) => {
  await enable(page); await loot(page, { name: '波利卡片', badge: '卡片' });
  await expect(page.locator('#status')).toContainText('即將取得');
  await page.getByRole('checkbox', { name: '自動選牌', exact: true }).uncheck();
  await page.waitForTimeout(1700); expect(await taken(page)).toEqual([]);
  await page.locator('#auto-collect-loot').uncheck(); await enable(page);
  await page.waitForTimeout(1700); expect(await taken(page)).toEqual([]);
  await page.locator('#auto-collect-loot').check();
  await expect.poll(() => taken(page)).toEqual(['波利卡片']);
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await expect(page.locator('#auto-collect-loot')).toBeChecked();
});

test('takes eggs, unknown and unlabelled loot, and loot won in a roll using the same setting', async ({ page }) => {
  const collect = page.getByRole('checkbox', { name: '自動取得掉落物' });
  await collect.uncheck(); await enable(page);
  const won = { name: '短劍', result: true };
  const unlabelled = { name: '', badge: '', next: won };
  const unknown = { name: '新物品', badge: '未知種類', next: unlabelled };
  await loot(page, { name: '波利蛋', badge: '寵物蛋', next: unknown });
  await expect(page.locator('#status')).toContainText('自動取得尚未啟用');
  await page.waitForTimeout(1700); expect(await taken(page)).toEqual([]);
  await collect.check();
  await expect.poll(() => taken(page), { timeout: 11000 }).toEqual(['波利蛋', '新物品', '', '短劍']);
});

test('continue and disabled get buttons remain manual', async ({ page }) => {
  await enable(page);
  for (const options of [{ label: '繼續', result: true, badge: '卡片' }, { label: '繼續' }, { badge: '卡片', disabled: true }]) {
    await loot(page, options); await expect(page.locator('#status')).toContainText('保留手動');
    await page.waitForTimeout(1000);
  }
  expect(await taken(page)).toEqual([]);
  expect(await page.evaluate(() => (window as any).lootClicks)).toEqual([]);
});

async function rollChoices(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).lootClicks.map((click: { choice: string }) => click.choice));
}

test('collects repeated card drops and a won card after a separate greed roll', async ({ page }) => {
  const artwork = 'assets/cards/4001.png?v=2';
  const card = { name: '波利卡片', badge: '卡片' };
  const won = { ...card, result: true, artwork, badge: 'Card', label: 'Get' };
  const roll = { ...card, artwork, roll: true, next: won };
  await enable(page);
  await loot(page, { ...card, next: { ...card, artwork, badge: '未知', next: roll } });
  await expect.poll(() => taken(page), { timeout: 11000 }).toEqual(Array(4).fill(card.name));
  const clicks = await page.evaluate(() => (window as any).lootClicks);
  expect(clicks.map((click: any) => click.choice ?? click.target)).toEqual(['dr-get', 'dr-get', 'greed', 'dr-get']);
  expect(clicks.every((click: any) => click.elapsed >= 750)).toBe(true);
});

test('preview and automatic rolls use the item category for consecutive drops', async ({ page }) => {
  const egg = { roll: true, badge: '寵物蛋 · 一般', artwork: 'assets/items/9001.png' };
  const shield = { roll: true, artwork: 'assets/items/2101_art.png', next: egg };
  await loot(page, { roll: true, next: { roll: true, next: shield } });
  await expect(page.locator('#status')).toContainText('武器）選 Need');
  await page.waitForTimeout(1600);
  expect(await rollChoices(page)).toEqual([]);
  await enable(page);
  await expect.poll(() => rollChoices(page), { timeout: 11000 }).toEqual(['need', 'need', 'greed', 'greed']);
  expect(await page.evaluate(() => (window as any).lootClicks.every((c: any) => c.elapsed >= 750))).toBe(true);
  await expect(page.locator('#logs')).toContainText('寵物蛋）選 Greed');
});

test('edits, opt-out and reload apply saved rules separately from acquiring equipment', async ({ page }) => {
  await page.getByText('組隊分寶', { exact: true }).click();
  await expect(page.getByLabel('武器', { exact: true })).toHaveValue('need');
  await page.getByLabel('武器', { exact: true }).selectOption('greed');
  await page.getByLabel('卡片', { exact: true }).selectOption('need');
  await page.getByLabel('組隊自動擲骰').uncheck();
  await page.reload();
  await page.addScriptTag({ content: await readFile('tests/loot-fixture.js', 'utf8') });
  await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await page.getByText('組隊分寶', { exact: true }).click();
  await expect(page.getByLabel('組隊自動擲骰')).not.toBeChecked();
  await expect(page.getByLabel('武器', { exact: true })).toHaveValue('greed');
  await enable(page);
  await loot(page, { roll: true, next: { roll: true, artwork: 'assets/cards/4001.png', badge: '卡片' } });
  await page.waitForTimeout(1800);
  expect(await rollChoices(page)).toEqual([]);
  await page.locator('#auto-collect-loot').uncheck();
  await page.getByLabel('組隊自動擲骰').check();
  await expect.poll(() => rollChoices(page), { timeout: 6500 }).toEqual(['greed', 'need']);
});

test('manual pass, a disabled choice and an expired roll never trigger a substitute vote', async ({ page }) => {
  await enable(page);
  await loot(page, { roll: true, disabled: 'need' });
  await page.waitForTimeout(1700);
  expect(await rollChoices(page)).toEqual([]);
  await page.locator('.dr-roll button[data-c="pass"]').click();
  await loot(page, { roll: true });
  await expect(page.locator('#status')).toContainText('即將');
  await page.evaluate(() => { document.getElementById('drop-reveal')!.classList.add('hidden'); });
  await page.waitForTimeout(1700);
  expect(await rollChoices(page)).toEqual(['pass']);
});

test('an unacknowledged roll is attempted only once', async ({ page }) => {
  await enable(page);
  await loot(page, { roll: true, reject: true });
  await expect(page.locator('#status')).toContainText('遊戲未確認組隊分寶', { timeout: 6500 });
  expect(await rollChoices(page)).toEqual(['need']);
});

test('a pending roll honors a changed choice and pause before clicking', async ({ page }) => {
  await page.locator('#advanced summary').click();
  await page.locator('#delay-min').fill('2000'); await page.locator('#delay-min').blur();
  await page.getByText('組隊分寶', { exact: true }).click();
  await enable(page); await loot(page, { roll: true });
  await expect(page.locator('#status')).toContainText('武器）選 Need');
  await page.getByLabel('武器', { exact: true }).selectOption('greed');
  await expect(page.locator('#status')).toContainText('武器）選 Greed');
  await page.getByRole('checkbox', { name: '自動選牌', exact: true }).uncheck();
  await page.waitForTimeout(2200);
  expect(await rollChoices(page)).toEqual([]);
  await enable(page);
  await expect.poll(() => rollChoices(page)).toEqual(['greed']);
});

test('rejected acquisition pauses instead of repeatedly clicking get', async ({ page }) => {
  await enable(page); await loot(page, { reject: true });
  await expect(page.locator('#status')).toContainText('遊戲未確認取得「測試裝備」', { timeout: 6000 });
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
