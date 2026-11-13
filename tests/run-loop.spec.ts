import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test } from './browser-fixture';

test.beforeEach(async ({ page }) => {
  await page.addScriptTag({ content: await readFile('tests/run-fixture.js', 'utf8') });
  await page.locator('#loop-settings > summary').click();
});
async function configure(page: Page, name = '斐揚森林'): Promise<void> {
  await page.getByLabel('循環關卡', { exact: true }).fill(name);
  await page.getByLabel('循環關卡', { exact: true }).blur();
}
async function start(page: Page): Promise<void> { await page.getByRole('checkbox', { name: '循環刷關', exact: true }).click(); }
async function actions(page: Page): Promise<string[]> { return page.evaluate(() => (window as any).runFixture.actions); }

test('repeats two settlements, captain conversations and configurable expeditions while picking cards', async ({ page }, info) => {
  test.setTimeout(45000);
  await page.addScriptTag({ content: await readFile('tests/loot-fixture.js', 'utf8') });
  await page.getByRole('button', { name: '使用目前關卡', exact: true }).click();
  await expect(page.getByLabel('循環關卡', { exact: true })).toHaveValue('斐揚森林');
  await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).fill('A');
  await page.locator('#add-form button').click();
  await start(page);
  await expect(page.locator('#loop-status')).toContainText('戰鬥中');
  expect(await actions(page)).toEqual([]);
  for (let i = 1; i <= 2; i++) {
    await page.evaluate(() => (window as any).showRound({ cards: [{ name: 'A', fresh: true }] }));
    await expect.poll(() => page.evaluate(() => (window as any).selections.length)).toBe(i);
    await expect(page.locator('#picker')).toHaveClass(/hidden/);
    await page.evaluate(() => (window as any).showLoot());
    await page.evaluate(win => (window as any).runFixture.settle(win), i === 1);
    await expect(page.locator('#loop-status')).toContainText('等待掉落提示');
    expect((await actions(page)).filter(a => a === 'return')).toHaveLength(i - 1);
    await expect.poll(() => page.evaluate(() => (window as any).lootTaken.length)).toBe(i);
    await expect.poll(async () => (await actions(page)).filter(a => a === 'confirm').length, { timeout: 12000 }).toBe(i);
    await expect(page.locator('#loop-status')).toContainText('戰鬥中');
    await expect(page.locator('#loop-count')).toContainText(`已結算 ${i} 場`);
  }
  expect(await actions(page)).toEqual(['return', 'captain', 'select:斐揚森林', 'depart:斐揚森林', 'confirm', 'return', 'captain', 'depart:斐揚森林', 'confirm']);
  expect(await page.evaluate(() => (window as any).runFixture.confirmedDifficulty)).toEqual({ count: 2, damage: 1.25, hp: 1.5, speed: 1.1, events: 1.75 });
  expect(await page.evaluate(() => (window as any).lootClicks.length)).toBe(2);
  await page.screenshot({ path: info.outputPath('loop-two-rounds.png') });
});

test('captures a selected stage, exposes live unlocked choices and starts from town', async ({ page }) => {
  await page.evaluate(() => (window as any).runFixture.openStages());
  await page.getByRole('button', { name: '使用目前關卡', exact: true }).click();
  await expect(page.getByLabel('循環關卡', { exact: true })).toHaveValue('普隆德拉原野');
  await expect(page.locator('#loop-stages option')).toHaveCount(3);
  await page.evaluate(() => (window as any).runFixture.lobby());
  await start(page);
  await expect(page.locator('#loop-status')).toContainText('戰鬥中', { timeout: 8000 });
  expect(await actions(page)).toEqual(['captain', 'depart:普隆德拉原野', 'confirm']);
});

test('settlement interrupted by the lobby picker goes offline, counts once and departs again', async ({ page }) => {
  await configure(page);
  await page.evaluate(() => {
    const f = (window as any).runFixture; f.chooseLobbyOnReturn = true; f.settle();
  });
  await start(page);
  await expect.poll(() => actions(page), { timeout: 15_000 }).toEqual(['return', 'offline', 'captain', 'select:斐揚森林', 'depart:斐揚森林', 'confirm']);
  await expect(page.locator('#loop-count')).toContainText('已結算 1 場');
  await expect(page.locator('#loop-status')).toContainText('戰鬥中');
});

test('only clicks the ready offline option once in an open lobby picker', async ({ page }) => {
  await configure(page);
  await page.evaluate(() => {
    const f = (window as any).runFixture; f.reject = 'offline'; f.openLobbyChoice();
  });
  await page.waitForTimeout(1100);
  expect(await actions(page)).toEqual([]);
  const offline = page.getByRole('button', { name: '離線遊玩', exact: true });
  await offline.evaluate(button => (button as HTMLButtonElement).disabled = true);
  await start(page);
  await expect(page.locator('#loop-status')).toContainText('等待「離線遊玩」按鈕就緒');
  expect(await actions(page)).toEqual([]);
  await offline.evaluate(button => (button as HTMLButtonElement).disabled = false);
  await expect.poll(() => actions(page)).toEqual(['offline']);
  await page.waitForTimeout(1500);
  expect(await actions(page)).toEqual(['offline']);
  await page.evaluate(() => (window as any).runFixture.lobby());
  await expect.poll(() => actions(page)).toContain('captain');
  await expect(page.locator('#loop-count')).toContainText('已結算 0 場');
});

test('a manual lobby choice cancels a pending offline click', async ({ page }) => {
  await configure(page); await page.evaluate(() => (window as any).runFixture.openLobbyChoice());
  await start(page);
  await expect(page.locator('#loop-status')).toContainText('即將選擇離線遊玩');
  await page.getByRole('button', { name: '阿斯嘉特' }).click();
  await expect(page.locator('#loop-toggle')).not.toBeChecked();
  await page.waitForTimeout(1200);
  expect(await actions(page)).toEqual(['online']);
});

test('blank target cannot enable the loop or auto picker', async ({ page }) => {
  await start(page);
  await expect(page.locator('#loop-status')).toContainText('請先設定');
  await expect(page.locator('#mode')).toContainText('PREVIEW');
  expect(await actions(page)).toEqual([]);
});

for (const [name, reason] of [['不存在', '找不到'], ['未解鎖關卡', '尚未解鎖'], ['故事關卡', '目前無法出發']]) {
  test(`does not depart from an unavailable target: ${name}`, async ({ page }) => {
    await configure(page, name);
    await page.evaluate(() => (window as any).runFixture.openStages());
    await start(page);
    await expect(page.locator('#loop-status')).toContainText(reason);
    await expect(page.locator('#mode')).toContainText('PREVIEW');
    expect((await actions(page)).filter(a => a.startsWith('depart') || ['confirm', 'story', 'skip'].includes(a))).toEqual([]);
  });
}

test('global pause cancels the pending settlement return and both automations', async ({ page }) => {
  await configure(page); await page.evaluate(() => (window as any).runFixture.settle()); await start(page);
  await expect(page.locator('#loop-status')).toContainText('即將完成結算');
  await page.getByRole('button', { name: '全部暫停', exact: true }).click();
  await page.waitForTimeout(3000);
  expect(await actions(page)).toEqual([]);
  await expect(page.locator('#loop-status')).toContainText('暫停');
  await expect(page.locator('#mode')).toContainText('PREVIEW');
});

test('pausing during difficulty prevents departure confirmation', async ({ page }) => {
  await configure(page); await page.evaluate(() => { (window as any).runFixture.selected = '斐揚森林'; (window as any).runFixture.openStages(); }); await start(page);
  await expect(page.locator('#npc-dialog')).toBeVisible();
  await page.getByRole('checkbox', { name: '循環刷關', exact: true }).uncheck();
  await page.waitForTimeout(1300);
  expect(await actions(page)).toEqual(['depart:斐揚森林']);
});

test('changing the target cancels queued return instead of departing with stale settings', async ({ page }) => {
  await configure(page); await page.evaluate(() => (window as any).runFixture.settle()); await start(page);
  await configure(page, '普隆德拉原野');
  await expect(page.locator('#loop-status')).toContainText('目標關卡已變更');
  await page.waitForTimeout(3000);
  expect(await actions(page)).toEqual([]);
});

test('adjusting difficulty manually cancels the queued confirmation', async ({ page }) => {
  await configure(page); await page.evaluate(() => { (window as any).runFixture.selected = '斐揚森林'; (window as any).runFixture.openStages(); }); await start(page);
  await expect(page.locator('#npc-dialog')).toBeVisible();
  await page.locator('#npc-text [data-key="count"]').press('ArrowRight');
  await expect(page.locator('#loop-status')).toContainText('調整難度');
  await page.waitForTimeout(1300);
  expect(await actions(page)).toEqual(['depart:斐揚森林']);
});

for (const dialog of ['saved', 'party']) {
  test(`leaves ${dialog} dialog for the user without confirming or discarding`, async ({ page }) => {
    await configure(page);
    await page.evaluate(dialog => { const f = (window as any).runFixture; f.dialog = dialog; f.selected = '斐揚森林'; f.openStages(); }, dialog);
    await start(page);
    await expect(page.locator('#loop-status')).toContainText('需要手動處理');
    expect(await actions(page)).toEqual(['depart:斐揚森林']);
    await expect(page.locator('#mode')).toContainText('PREVIEW');
  });
}

test('does not confirm a difficulty dialog it did not open for its configured stage', async ({ page }) => {
  await configure(page); await page.evaluate(() => (window as any).runFixture.openDifficulty()); await start(page);
  await expect(page.locator('#loop-status')).toContainText('需要手動處理');
  expect(await actions(page)).toEqual([]);
});

test('rejected captain interaction is clicked once, then times out without retry', async ({ page }) => {
  await configure(page); await page.evaluate(() => { (window as any).runFixture.reject = 'captain'; (window as any).runFixture.lobby(); }); await start(page);
  await expect.poll(() => actions(page)).toEqual(['captain']);
  await expect(page.locator('#loop-status')).toContainText('遊戲未確認', { timeout: 11000 });
  expect(await actions(page)).toEqual(['captain']);
  await expect(page.locator('#mode')).toContainText('PREVIEW');
});

test('does not talk to another NPC and explains how to resume near the captain', async ({ page }) => {
  await configure(page); await page.evaluate(() => { (window as any).runFixture.lobby(); document.getElementById('lobby-prompt')!.textContent = '與商人交談'; }); await start(page);
  await expect(page.locator('#loop-status')).toContainText('請靠近遠征隊長');
  await page.waitForTimeout(1300);
  expect(await actions(page)).toEqual([]);
  await page.evaluate(() => { document.getElementById('lobby-prompt')!.textContent = '與隊長交談'; });
  await expect.poll(() => actions(page)).toContain('captain');
});

test('background cancels pending return; foreground waits again and resumes once', async ({ page }) => {
  // The real content script runs in an isolated world: a main-world property
  // override would not affect what the extension observes.
  const session = await page.context().newCDPSession(page);
  const contexts: { id: number; name: string; origin: string; auxData?: { isDefault?: boolean } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await session.send('Runtime.enable');
  const isolated = contexts.find(context => !context.auxData?.isDefault && (context.origin.startsWith('chrome-extension://') || context.name.startsWith('chrome-extension://')));
  expect(isolated, JSON.stringify(contexts)).toBeTruthy();
  const visibility = async (value: 'visible' | 'hidden') => {
    await session.send('Runtime.evaluate', { contextId: isolated!.id, expression: `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${value}' }); document.dispatchEvent(new Event('visibilitychange'));` });
  };
  await configure(page); await page.evaluate(() => (window as any).runFixture.settle()); await start(page);
  await visibility('hidden');
  await expect(page.locator('#loop-status')).toContainText('分頁在背景');
  await page.waitForTimeout(3000); expect(await actions(page)).toEqual([]);
  await visibility('visible');
  await expect.poll(() => actions(page)).toContain('return');
  expect((await actions(page)).filter(a => a === 'return')).toHaveLength(1);
  await session.detach();
});

test('manual stage selection stops the loop and cancels the pending stage click', async ({ page }) => {
  await configure(page); await page.evaluate(() => (window as any).runFixture.openStages()); await start(page);
  await page.locator('#stg-list button').filter({ hasText: '普隆德拉原野' }).click();
  await expect(page.locator('#loop-status')).toContainText('交由你操作');
  await page.waitForTimeout(1200);
  expect(await actions(page)).toEqual(['select:普隆德拉原野']);
});

test('a picker acknowledgement error also stops the loop', async ({ page }) => {
  await configure(page);
  await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).fill('A'); await page.locator('#add-form button').click();
  await page.evaluate(() => (window as any).showRound({ cards: [{ name: 'A' }], reject: true })); await start(page);
  await expect(page.locator('#status')).toContainText('遊戲未確認選牌');
  await expect(page.locator('#loop-status')).toContainText('自動選牌已停止');
});

test('reload retains target but never resumes the loop or picker automatically', async ({ page }) => {
  await configure(page); await start(page); await expect(page.locator('#loop-status')).toContainText('戰鬥中');
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click(); await page.locator('#loop-settings > summary').click();
  await expect(page.getByLabel('循環關卡', { exact: true })).toHaveValue('斐揚森林');
  await expect(page.locator('#loop-status')).toContainText('尚未啟用');
  await expect(page.locator('#mode')).toContainText('PREVIEW');
});
