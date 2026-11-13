import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { test } from './browser-fixture';

async function steps(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).walkEvents as string[]);
}
async function start(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: '小範圍走動', exact: true }).click();
}
async function setNumber(page: Page, id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).fill(value);
  await page.locator(`#${id}`).blur();
}

test.beforeEach(async ({ page }) => {
  await page.addScriptTag({ content: await readFile('tests/run-fixture.js', 'utf8') });
  await page.evaluate(() => {
    const coords = document.createElement('span');
    coords.id = 'minimap-coords'; coords.textContent = '(40, 50)';
    document.getElementById('hud')!.append(coords);
    const events: string[] = [];
    (window as any).walkEvents = events;
    const stage = document.createElement('button');
    stage.id = 'stage';
    stage.textContent = '遊戲場地';
    document.getElementById('hud')!.append(stage);
    // Simulate a rotated camera. The minimap axes differ from screen directions.
    const moves: Record<string, number[]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    let x = 40, y = 50;
    (window as any).setWalkPosition = (nextX: number, nextY: number) => {
      x = nextX; y = nextY; coords.textContent = `(${x}, ${y})`;
    };
    window.addEventListener('keydown', e => {
      if (e.isTrusted || !moves[e.key]) return;
      events.push('down ' + e.key);
      if (!(window as any).wall) { x += moves[e.key][0]; y += moves[e.key][1]; coords.textContent = `(${x}, ${y})`; }
      (window as any).maxDistance = Math.max((window as any).maxDistance || 0, Math.hypot(x - 40, y - 50));
    });
    window.addEventListener('keyup', e => { if (!e.isTrusted && moves[e.key]) events.push('up ' + e.key); });
  });
  await page.locator('#walk-settings summary').click();
});

test('walking stays independent of linked loop and picker checkboxes until all are paused', async ({ page }) => {
  await page.locator('#loop-settings > summary').click();
  await page.getByRole('button', { name: '使用目前關卡' }).click();
  await page.locator('#loop-settings > summary').click();
  const loop = page.getByRole('checkbox', { name: '循環刷關', exact: true });
  const picker = page.getByRole('checkbox', { name: '自動選牌', exact: true });
  const walk = page.getByRole('checkbox', { name: '小範圍走動', exact: true });
  await walk.check();
  await loop.check();
  await expect(picker).toBeChecked();
  await loop.uncheck();
  await expect(picker).not.toBeChecked();
  await expect(walk).toBeChecked();
  await loop.check();
  await picker.uncheck();
  await expect(loop).not.toBeChecked();
  await expect(walk).toBeChecked();
  await loop.check();
  await page.getByRole('button', { name: '全部暫停' }).click();
  for (const checkbox of [loop, picker, walk]) await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole('button', { name: '全部暫停' })).toBeDisabled();
});

test('short pulses return to a fixed origin on a rotated map, then manual movement takes over', async ({ page }) => {
  await expect(page.locator('#walk-radius')).toHaveValue('3');
  await expect(page.locator('#walk-interval')).toHaveValue('2');
  await setNumber(page, 'walk-radius', '2');
  await setNumber(page, 'walk-interval', '1');
  await start(page);
  await expect.poll(async () => (await steps(page)).length, { timeout: 8000 }).toBeGreaterThanOrEqual(8);
  await expect(page.locator('#minimap-coords')).toHaveText('(40, 50)');
  expect(await page.evaluate(() => (window as any).maxDistance)).toBe(1);
  const events = await steps(page);
  for (let i = 0; i < 8; i += 2) expect(events[i + 1]).toBe(events[i].replace('down ', 'up '));
  await page.keyboard.press('w');
  await expect(page.locator('#walk-status')).toContainText('手動移動');
  await expect(page.locator('#walk-toggle')).toBeChecked();
  await page.waitForTimeout(1300);
  expect(await steps(page)).toEqual(events);
  await page.reload();
  await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await page.locator('#walk-settings summary').click();
  await expect(page.locator('#walk-toggle')).not.toBeChecked();
  await expect(page.locator('#walk-radius')).toHaveValue('2');
  await expect(page.locator('#walk-interval')).toHaveValue('1');
});

test('pauses during a picker and on displacement, then resumes inside the original radius', async ({ page }) => {
  await setNumber(page, 'walk-interval', '1');
  await start(page);
  await page.evaluate(() => (window as any).showRound({ cards: [{ name: '測試技能' }] }));
  await expect(page.locator('#walk-status')).toContainText('走動暫停');
  await page.waitForTimeout(1400);
  expect(await steps(page)).toEqual([]);
  await page.evaluate(() => document.getElementById('picker')!.classList.add('hidden'));
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { document.getElementById('minimap-coords')!.textContent = '(80, 80)'; });
  await expect(page.locator('#walk-status')).toContainText('超出活動半徑');
  await expect(page.locator('#walk-toggle')).toBeChecked();
  const paused = await steps(page);
  await page.evaluate(() => (window as any).setWalkPosition(40, 50));
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThan(paused.length);
});

test('walking waits for missing coordinates before moving; a blocked direction retries and keeps the origin', async ({ page }) => {
  await page.evaluate(() => { document.getElementById('minimap-coords')!.textContent = ''; });
  await start(page);
  await expect(page.locator('#walk-status')).toContainText('等待小地圖座標');
  await expect(page.locator('#walk-toggle')).toBeChecked();
  expect(await steps(page)).toEqual([]);
  await page.evaluate(() => { document.getElementById('minimap-coords')!.textContent = '(40, 50)'; (window as any).wall = true; });
  await setNumber(page, 'walk-interval', '0.25');
  await expect(page.locator('#walk-status')).toContainText('走動受阻');
  expect(await steps(page)).toHaveLength(8);
  await expect(page.locator('#walk-toggle')).toBeChecked();
  await page.evaluate(() => { (window as any).wall = false; });
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThanOrEqual(12);
  const events = await steps(page);
  expect(events[8]).not.toBe(events[0]);
  await expect(page.locator('#walk-status')).toContainText('起點 (40, 50)');
});

test('held keys and a subsequent field click delay walking until ten seconds after the last release', async ({ page }) => {
  test.setTimeout(35_000);
  await start(page);
  await page.keyboard.down('d');
  await page.evaluate(() => (window as any).setWalkPosition(90, 100));
  await page.waitForTimeout(10_200);
  expect(await steps(page)).toEqual([]);
  await expect(page.locator('#walk-status')).toContainText('手動移動中');
  await page.keyboard.up('d');
  await page.waitForTimeout(1500);
  await page.locator('#stage').click();
  await expect(page.locator('#walk-status')).toContainText('10 秒後');
  await page.waitForTimeout(8500);
  expect(await steps(page)).toEqual([]);
  await expect.poll(async () => (await steps(page)).length, { timeout: 2500 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#walk-status')).toContainText('起點 (90, 100)');
});

test('pausing all during the manual countdown cancels the scheduled movement', async ({ page }) => {
  await start(page);
  await page.locator('#stage').click();
  await expect(page.locator('#walk-status')).toContainText('10 秒後');
  await page.getByRole('button', { name: '全部暫停' }).click();
  await page.waitForTimeout(10_300);
  await expect(page.locator('#walk-toggle')).not.toBeChecked();
  expect(await steps(page)).toEqual([]);
});

test('custom numbers survive reload; focus in the assistant and missing HUD data recover without toggling', async ({ page }) => {
  await setNumber(page, 'walk-radius', '7');
  await setNumber(page, 'walk-interval', '0.375');
  await setNumber(page, 'walk-radius', '1.5');
  await setNumber(page, 'walk-interval', '0');
  await expect(page.locator('#walk-input-error')).toBeVisible();
  await expect(page.locator('#walk-radius')).toHaveValue('7');
  await expect(page.locator('#walk-interval')).toHaveValue('0.375');
  await start(page);
  await page.locator('#walk-radius').focus();
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { document.getElementById('minimap-coords')!.textContent = ''; });
  await expect(page.locator('#walk-status')).toContainText('等待小地圖');
  await page.evaluate(() => { document.getElementById('hud')!.classList.add('hidden'); });
  await expect(page.locator('#walk-status')).toContainText('返回戰鬥');
  const paused = await steps(page);
  await page.evaluate(() => { (window as any).runFixture.battle(); (window as any).setWalkPosition(40, 50); });
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThan(paused.length);
  await page.reload();
  await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await page.locator('#walk-settings summary').click();
  await expect(page.locator('#walk-radius')).toHaveValue('7');
  await expect(page.locator('#walk-interval')).toHaveValue('0.375');
});

test('background and loot suspend walking, settlement preserves standby for the next battle', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  let contentWorld: number | undefined;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.origin.startsWith('chrome-extension://') || context.name.startsWith('chrome-extension://')) contentWorld = context.id;
  });
  await cdp.send('Runtime.enable');
  expect(contentWorld).toBeDefined();
  const visibility = (value: 'hidden' | 'visible') => cdp.send('Runtime.evaluate', {
    contextId: contentWorld,
    expression: `Object.defineProperty(document, 'visibilityState', {configurable: true, value: '${value}'}); document.dispatchEvent(new Event('visibilitychange'));`,
  });
  await setNumber(page, 'walk-interval', '1');
  await start(page);
  await visibility('hidden');
  await page.waitForTimeout(1500);
  expect(await steps(page)).toEqual([]);
  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.id = 'drop-reveal'; dialog.textContent = '取得'; document.body.append(dialog);
  });
  await visibility('visible');
  await cdp.detach();
  await expect(page.locator('#walk-status')).toContainText('走動暫停');
  await page.waitForTimeout(1300);
  expect(await steps(page)).toEqual([]);
  await page.locator('#drop-reveal').evaluate(el => el.remove());
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as any).runFixture.settle());
  await expect(page.locator('#walk-status')).toContainText('走動待命');
  await expect(page.locator('#walk-toggle')).toBeChecked();
  const stopped = await steps(page);
  await page.evaluate(() => (window as any).runFixture.lobby());
  await page.waitForTimeout(1300);
  expect(await steps(page)).toEqual(stopped);
  await page.evaluate(() => { (window as any).setWalkPosition(85, 70); (window as any).runFixture.battle(); });
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThan(stopped.length);
  await expect(page.locator('#walk-status')).toContainText('起點 (85, 70)');
});

test('walking armed in town waits through the stage and difficulty menus; cancelling standby prevents later steps', async ({ page }) => {
  await page.evaluate(() => (window as any).runFixture.lobby());
  await setNumber(page, 'walk-interval', '0.25');
  await start(page);
  await expect(page.locator('#walk-toggle')).toBeChecked();
  await expect(page.locator('#walk-status')).toContainText('走動待命');
  await page.waitForTimeout(650);
  await page.evaluate(() => (window as any).runFixture.openStages());
  await page.waitForTimeout(650);
  await page.evaluate(() => (window as any).runFixture.openDifficulty());
  await page.waitForTimeout(650);
  expect(await steps(page)).toEqual([]);
  await page.evaluate(() => (window as any).runFixture.battle());
  await expect.poll(async () => (await steps(page)).length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as any).runFixture.settle(false));
  await expect(page.locator('#walk-status')).toContainText('走動待命');
  const stopped = await steps(page);
  await page.locator('#walk-toggle').uncheck();
  await page.evaluate(() => (window as any).runFixture.battle());
  await page.waitForTimeout(1000);
  expect(await steps(page)).toEqual(stopped);
});
