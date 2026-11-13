import { expect, type Page } from '@playwright/test';
import { test } from './browser-fixture';
async function add(page: Page, name: string): Promise<void> {
  await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).fill(name);
  await page.locator('#add-form').getByRole('button', { name: '加入', exact: true }).click();
  await expect(page.locator('#priorities .name').filter({ hasText: name })).toBeVisible();
}
async function round(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(options => (window as any).showRound(options), options);
}
async function selections(page: Page): Promise<any[]> { return page.evaluate(() => (window as any).selections); }
async function enable(page: Page): Promise<void> { await page.getByRole('checkbox', { name: '自動選牌', exact: true }).check(); }
async function perks(page: Page): Promise<any[]> { return page.evaluate(() => (window as any).perkAttempts); }
async function toggleRule(page: Page, rule: '專注' | '取得後放逐', name: string): Promise<void> {
  await page.getByRole('button', { name: `${rule} ${name}`, exact: true }).click();
}

test('all automation checkboxes are visible at the top and reflect rejected starts', async ({ page }, info) => {
  await page.setViewportSize({ width: 925, height: 390 });
  const panel = page.locator('#panel');
  const automation = panel.getByRole('region', { name: '自動功能' });
  const checks = automation.getByRole('checkbox');
  await expect(panel.locator('.body > :first-child')).toHaveAttribute('id', 'automation');
  await expect(panel.locator('details[open]')).toHaveCount(0);
  await expect(panel.locator('details input[type=checkbox]')).toHaveCount(0);
  await expect(checks).toHaveCount(11);
  for (const box of await checks.all()) await expect(box).toBeInViewport({ ratio: 1 });
  await automation.screenshot({ path: info.outputPath('automation.png') });

  const loop = automation.getByRole('checkbox', { name: '循環刷關' });
  await loop.click();
  await expect(loop).not.toBeChecked();
  await expect(panel.locator('#loop-status')).toContainText('請先設定循環關卡');
  const walk = automation.getByRole('checkbox', { name: '小範圍走動' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await walk.click();
    await expect(walk).not.toBeChecked();
    await expect(panel.locator('#walk-status')).toBeVisible();
  }
  await expect(automation.getByRole('button', { name: '全部暫停' })).toBeDisabled();
});

test('skills focus the first priority, banish owned last-two upgrades, then select on a compact screen', async ({ page }, info) => {
  for (const name of ['A', 'B', 'C', 'D']) await add(page, name);
  await toggleRule(page, '專注', 'A'); await toggleRule(page, '取得後放逐', 'C'); await toggleRule(page, '取得後放逐', 'D');
  await expect(page.locator('#priorities [aria-pressed="true"]')).toHaveText(['專注', '取得後放逐', '取得後放逐']);
  await round(page, { cards: [{ name: 'C' }, { name: 'A' }, { name: 'D' }], perks: { focus: 2, banish: 2, reroll: 2 } });
  await expect(page.locator('#status')).toContainText('預覽：專注');
  await page.screenshot({ path: info.outputPath('perks-preview.png') });
  await page.waitForTimeout(1600); expect(await perks(page)).toEqual([]);
  await page.setViewportSize({ width: 925, height: 390 });
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name, { timeout: 9000 }).toBe('A');
  expect(await perks(page)).toEqual([{ kind: 'focus', name: 'A' }, { kind: 'banish', name: 'D' }, { kind: 'banish', name: 'C' }]);
  expect(await page.evaluate(() => (window as any).clickAttempts)).toEqual([0]);
  await expect(page.locator('#logs')).toContainText('已專注「A」');
  await expect(page.locator('#logs')).toContainText('已放逐「D」');
});

test('last two skills are acquired first, banished on later upgrades, and acquired again in a new run', async ({ page }) => {
  for (const name of ['A', 'B', 'C', 'D']) await add(page, name);
  await toggleRule(page, '取得後放逐', 'C'); await toggleRule(page, '取得後放逐', 'D');
  await page.setViewportSize({ width: 925, height: 390 });
  await round(page, { cards: [{ name: 'D', badge: '技能', fresh: true }, { name: 'C', badge: '技能', fresh: true }], perks: { banish: 2, reroll: 2 } });
  await expect(page.locator('#current')).toContainText('尚未取得');
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('C');
  expect(await perks(page)).toEqual([]);
  await expect(page.locator('#picker')).toHaveClass(/hidden/);

  await round(page, { cards: [{ name: 'C', badge: '普通' }, { name: 'D', badge: '技能', fresh: true }], perks: { banish: 2, reroll: 2 } });
  await expect(page.locator('#current')).toContainText('已取得・升級牌');
  await expect.poll(async () => (await selections(page))[1]?.name, { timeout: 6000 }).toBe('D');
  expect(await perks(page)).toEqual([{ kind: 'banish', name: 'C' }]);
  await expect(page.locator('#picker')).toHaveClass(/hidden/);

  await round(page, { cards: [{ name: 'D', badge: '普通' }, { name: 'A', badge: '技能', fresh: true }], perks: { banish: 1, reroll: 2 } });
  await expect.poll(async () => (await selections(page))[2]?.name, { timeout: 6000 }).toBe('A');
  expect(await perks(page)).toEqual([{ kind: 'banish', name: 'C' }, { kind: 'banish', name: 'D' }]);
  await expect(page.locator('#picker')).toHaveClass(/hidden/);

  // A fresh card in a new run must not inherit earlier ownership or banishment.
  await round(page, { cards: [{ name: 'C', badge: '技能', fresh: true }], perks: { banish: 2, reroll: 2 } });
  await expect.poll(async () => (await selections(page))[3]?.name).toBe('C');
  expect(await perks(page)).toHaveLength(2);
});

test('unknown skill state is not treated as owned solely because its new ribbon is absent', async ({ page }) => {
  for (const name of ['A', 'C', 'D']) await add(page, name);
  await toggleRule(page, '取得後放逐', 'D');
  await round(page, { cards: [{ name: 'D', badge: '未知標籤' }], perks: { banish: 2, reroll: 2 } });
  await expect(page.locator('#current')).toContainText('取得狀態未知');
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('D');
  expect(await perks(page)).toEqual([]);
});

test('skills reroll identical non-target decks until a target appears without clicking per-card reroll', async ({ page }) => {
  await add(page, 'A');
  await round(page, { cards: [{ name: 'Other' }], perks: { focus: 0, banish: 0, reroll: 2 }, englishActions: true, rerollDecks: [[{ name: 'Other' }], [{ name: 'A' }]] });
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name, { timeout: 7000 }).toBe('A');
  expect(await perks(page)).toEqual([{ kind: 'reroll', name: null }, { kind: 'reroll', name: null }]);
  expect(await page.evaluate(() => (window as any).rerolls)).toBe(0);
});

test('chest reroll precedes rarity and replacement fallback and ignores skill marks', async ({ page }) => {
  for (const name of ['Potion', 'C', 'D']) await add(page, name);
  await toggleRule(page, '專注', 'Potion'); await toggleRule(page, '取得後放逐', 'D');
  await page.getByRole('button', { name: '寶箱道具', exact: true }).click(); await add(page, 'Elixir');
  await page.locator('#chest-fallback').check(); await page.locator('#chest-replace').uncheck();
  await round(page, { title: '寶箱', gain: false, cards: [{ name: 'Potion', badge: '傳說', confirm: true }, { name: 'D', badge: '普通' }], perks: { focus: 2, banish: 2, reroll: 2 }, rerollDecks: [[{ name: 'Elixir +3', badge: '普通' }]] });
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name, { timeout: 6000 }).toBe('Elixir +3');
  expect(await perks(page)).toEqual([{ kind: 'reroll', name: null }]);
  expect(await page.evaluate(() => (window as any).confirmAttempts)).toEqual([]);
});

test('exhausted rerolls stop at manual fallback and an empty list never consumes rerolls', async ({ page }) => {
  await add(page, 'A');
  await round(page, { cards: [{ name: 'Other' }], perks: { reroll: 1 } }); await enable(page);
  await expect.poll(async () => (await perks(page)).length).toBe(1);
  await expect(page.locator('#status')).toContainText('沒有符合');
  await page.waitForTimeout(1800); expect(await selections(page)).toEqual([]); expect(await perks(page)).toHaveLength(1);
  await page.getByRole('button', { name: '移除 A', exact: true }).click();
  await round(page, { cards: [{ name: 'Other' }], perks: { reroll: 5 } });
  await page.waitForTimeout(1800); expect(await perks(page)).toHaveLength(1);
  await page.locator('#fallback').check();
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('Other');
  expect(await perks(page)).toHaveLength(1);
});

test('chest marks persist by name, focus the configured item and banish only its owned upgrade', async ({ page }) => {
  await page.locator('#kind-chest').click();
  await add(page, '護符'); await add(page, '指環');
  await toggleRule(page, '取得後放逐', '護符'); await toggleRule(page, '專注', '指環');
  await page.getByRole('button', { name: '上移 指環', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await page.locator('#kind-chest').click();
  await expect(page.getByRole('button', { name: '專注 指環', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const chest = { title: '寶箱', gain: false, perks: { focus: 1, banish: 1, reroll: 1 } };
  await round(page, { ...chest, cards: [{ name: '護符', badge: '傳說', fresh: true }] });
  await enable(page); await expect.poll(async () => (await selections(page))[0]?.name).toBe('護符');
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page, { ...chest, cards: [{ name: '護符 +1', badge: '傳說' }, { name: '指環 +2', badge: '普通' }] });
  await expect.poll(async () => (await selections(page))[1]?.name, { timeout: 9000 }).toBe('指環 +2');
  expect(await perks(page)).toEqual([{ kind: 'focus', name: '指環 +2' }, { kind: 'banish', name: '護符 +1' }]);
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page, { ...chest, cards: [{ name: '護符 +2' }] });
  await expect(page.locator('#logs')).toContainText('已放逐「護符 +2」');
  await expect(page.locator('#toggle')).toBeChecked();
});

test('banish targets stay excluded after uses run out and never count as wanted cards for reroll', async ({ page }) => {
  for (const name of ['A', 'C', 'D']) await add(page, name);
  await toggleRule(page, '取得後放逐', 'C'); await toggleRule(page, '取得後放逐', 'D');
  await page.locator('#fallback').check();
  await round(page, { cards: [{ name: 'C', badge: '傳說' }, { name: 'D', badge: '傳說' }], perks: { banish: 1, reroll: 1 }, rerollDecks: [[{ name: 'C', badge: '傳說' }, { name: 'Other', badge: '普通' }]] });
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name, { timeout: 7000 }).toBe('Other');
  expect(await perks(page)).toEqual([{ kind: 'banish', name: 'D' }, { kind: 'reroll', name: null }]);
});

test('pause cancels a pending perk and the focus mark follows the name after reordering', async ({ page }) => {
  await add(page, 'A'); await add(page, 'B');
  await toggleRule(page, '專注', 'A');
  await round(page, { cards: [{ name: 'A' }, { name: 'B' }], perks: { focus: 2, banish: 2, reroll: 2 } });
  await enable(page); await page.getByRole('checkbox', { name: '自動選牌', exact: true }).uncheck();
  await page.waitForTimeout(1800); expect(await perks(page)).toEqual([]);
  await enable(page); await page.getByRole('button', { name: '上移 B', exact: true }).click();
  await expect.poll(async () => (await selections(page))[0]?.name, { timeout: 6000 }).toBe('B');
  expect(await perks(page)).toEqual([{ kind: 'focus', name: 'A' }]);
});

test('a rejected perk pauses without consuming repeated attempts', async ({ page }) => {
  await add(page, 'A'); await toggleRule(page, '專注', 'A');
  await round(page, { cards: [{ name: 'A' }], perks: { focus: 2 }, rejectPerk: 'focus' }); await enable(page);
  await expect(page.locator('#status')).toContainText('遊戲未確認專注');
  await expect(page.getByRole('checkbox', { name: '自動選牌', exact: true })).not.toBeChecked();
  await page.waitForTimeout(1800);
  expect(await perks(page)).toEqual([{ kind: 'focus', name: 'A' }]); expect(await selections(page)).toEqual([]);
});

test('perk switches persist and their disabled rules leave normal priority selection', async ({ page }) => {
  for (const name of ['A', 'C', 'D']) await add(page, name);
  await toggleRule(page, '專注', 'C'); await toggleRule(page, '取得後放逐', 'C');
  await expect(page.getByRole('button', { name: '專注 C', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await toggleRule(page, '取得後放逐', 'C');
  for (const id of ['auto-reroll', 'chest-auto-reroll']) await page.locator(`#${id}`).uncheck();
  await expect(page.locator('#priorities [aria-pressed="true"]')).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  for (const id of ['auto-reroll', 'chest-auto-reroll']) await expect(page.locator(`#${id}`)).not.toBeChecked();
  await round(page, { cards: [{ name: 'D' }], perks: { focus: 2, banish: 2, reroll: 2 } }); await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('D'); expect(await perks(page)).toEqual([]);
});

for (const kind of ['levelup', 'chest'] as const) {
  test(`compact ${kind} picker still allows adding cards and automatic selection`, async ({ page }) => {
    await page.setViewportSize({ width: 925, height: 390 });
    const name = kind === 'chest' ? '傷害藥水' : 'Fire Bolt';
    await round(page, { title: kind === 'chest' ? '寶箱' : '升級！', gain: kind !== 'chest', cards: [{ name, badge: '普通', fresh: true }] });
    await expect(page.locator('#lu-sockets')).toBeHidden();
    await expect(page.locator('#pk-gain')).toBeHidden();
    const button = page.getByRole('button', { name: `加入 ${name} 到清單`, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('#priorities .name')).toHaveText([name]);
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('已加入');
    await expect(button).toHaveAttribute('title', kind === 'chest' ? '已在寶箱道具清單中' : '已在升級技能清單中');
    await enable(page);
    await expect.poll(async () => (await selections(page))[0]?.name).toBe(name);
    expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(1);
  });
}

test('compact layout still rejects inactive or unsupported picker metadata', async ({ page }) => {
  await page.setViewportSize({ width: 925, height: 390 });
  for (const options of [{ title: '升級！', sockets: false }, { title: '寶箱', gain: true }, { title: '劇情物品', gain: false }]) {
    await round(page, options);
    const button = page.getByRole('button', { name: '加入 Fire Bolt 到清單', exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('未支援');
    await expect(button).toHaveAttribute('title', /尚未辨識此選牌畫面/);
  }
  expect(await selections(page)).toHaveLength(0);
});

test('real MV3 content script previews, selects highest priority, and survives identical consecutive rounds', async ({ page }, info) => {
  await page.locator('#prefer-new-skills').uncheck();
  await add(page, 'Fire Bolt'); await add(page, 'Cold Bolt');
  await round(page, { closeMs: 200, next: {} });
  await expect(page.locator('.pk-card[data-ro-recommended="true"] .pk-name')).toHaveText('Fire Bolt');
  await page.waitForTimeout(1100); expect(await selections(page)).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('preview.png') });
  await enable(page);
  await expect.poll(async () => (await selections(page)).length).toBe(2);
  expect((await selections(page)).map(x => x.name)).toEqual(['Fire Bolt', 'Fire Bolt']);
  expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(2);
  await expect(page.locator('#status')).toHaveText('監看中 · 等待升級或寶箱選牌');
});
test('unmatched choices wait for manual input, fallback selects rarity, unknown rarity refuses a guess', async ({ page }) => {
  await add(page, 'Missing'); await round(page); await enable(page);
  await expect(page.locator('#status')).toContainText('沒有符合');
  await page.waitForTimeout(1200); expect(await selections(page)).toHaveLength(0);
  await page.locator('#fallback').check();
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('Cold Bolt');
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page, { cards: [{ name: 'A', badge: '未知' }, { name: 'B', badge: '傳說' }] });
  await expect(page.locator('#status')).toContainText('未知稀有度');
  await page.waitForTimeout(1200); expect(await selections(page)).toHaveLength(1);
});
test('pause cancels pending choice and reload preserves settings but disables auto', async ({ page }) => {
  await add(page, 'Fire Bolt'); await round(page); await enable(page);
  await page.getByRole('checkbox', { name: '自動選牌', exact: true }).uncheck();
  await page.waitForTimeout(1300); expect(await selections(page)).toHaveLength(0);
  await enable(page); await page.reload();
  await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await expect(page.locator('#priorities .name')).toHaveText(['Fire Bolt']);
  await expect(page.getByRole('checkbox', { name: '自動選牌', exact: true })).not.toBeChecked();
});
test('editing priority or replacing cards while pending cancels the stale choice', async ({ page }) => {
  await add(page, 'Fire Bolt'); await add(page, 'Cold Bolt'); await round(page); await enable(page);
  await page.getByRole('button', { name: '上移 Cold Bolt' }).click();
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('Cold Bolt');
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page); await page.waitForTimeout(200);
  await round(page, { cards: [{ name: 'Fire Bolt', badge: '普通' }, { name: 'Heal', badge: '傳說' }] });
  await expect.poll(async () => (await selections(page))[1]?.name).toBe('Fire Bolt');
  expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(2);
});
test('trusted manual mouse and keyboard choices take over the round without a duplicate click', async ({ page }) => {
  await add(page, 'Fire Bolt');
  await page.locator('#advanced summary').click(); await page.locator('#delay-min').fill('2500'); await page.locator('#delay-min').blur();
  await round(page); await enable(page); await page.waitForTimeout(850);
  await page.locator('.pk-card').nth(1).click();
  await page.waitForTimeout(2700); expect((await selections(page)).map(x => x.name)).toEqual(['Cold Bolt']);
  await round(page); await page.waitForTimeout(850);
  await page.locator('body').click({ position: { x: 20, y: 20 } }); await page.keyboard.press('3');
  await page.waitForTimeout(2700); expect((await selections(page)).map(x => x.name)).toEqual(['Cold Bolt', 'Heal']);
  expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(2);
});
test('manual reroll recognizes new cards without selecting a stale target', async ({ page }) => {
  await add(page, 'Fire Bolt'); await add(page, 'Cold Bolt'); await round(page, { rerolled: { cards: [{ name: 'Cold Bolt', badge: '普通' }] } }); await enable(page);
  await page.getByRole('button', { name: '重抽', exact: true }).click();
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('Cold Bolt');
  expect(await page.evaluate(() => (window as any).rerolls)).toBe(1);
});
test('unconfigured chest, story rewards, unknown picker and skill replacement remain manual', async ({ page }) => {
  await add(page, 'Fire Bolt'); await enable(page);
  for (const options of [
    { title: '寶箱', gain: false },
    { title: '劇情物品', gain: false },
    { title: 'New unsupported title' },
    { cards: [{ name: 'Fire Bolt', badge: '普通', confirm: true }] },
  ]) {
    await round(page, options); await page.waitForTimeout(1300);
    expect(await selections(page)).toHaveLength(0);
  }
  expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(0);
});

test('chest has separate priorities, captures base names, and evaluates new item rarity correctly', async ({ page }, info) => {
  await add(page, 'Fire Bolt');
  await round(page, { title: '寶箱', gain: false, cards: [{ name: 'Potion +3', badge: '普通' }, { name: 'Elixir', badge: '傳說', fresh: true }] });
  await expect(page.getByRole('button', { name: '寶箱道具', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '加入 Potion +3 到清單' }).click();
  await expect(page.locator('#priorities .name')).toHaveText(['Potion']);
  await page.getByRole('button', { name: '加入 Elixir 到清單' }).click();
  await page.screenshot({ path: info.outputPath('chest-preview.png') });
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('Elixir');
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page, { title: '寶箱', gain: false, cards: [{ name: 'Potion', badge: '傳說', fresh: true }, { name: 'Potion +4', badge: '普通' }] });
  await expect.poll(async () => (await selections(page))[1]?.name).toBe('Potion');
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page);
  await expect.poll(async () => (await selections(page))[2]?.name).toBe('Fire Bolt');
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await expect(page.locator('#priorities .name')).toHaveText(['Fire Bolt']);
  await page.getByRole('button', { name: '寶箱道具', exact: true }).click();
  await expect(page.locator('#priorities .name')).toHaveText(['Potion', 'Elixir']);
});

test('chest picks the best listed quality, confirms that item, and breaks quality ties by list order', async ({ page }) => {
  await page.getByRole('button', { name: '寶箱道具', exact: true }).click();
  await add(page, 'Potion'); await add(page, 'Elixir');
  await expect(page.locator('#priority-help')).toContainText('品質相同才依順位');
  await round(page, { title: '寶箱', gain: false,
    cards: [{ name: 'Outside', badge: '神話', confirm: true }, { name: 'Potion +9', badge: '普通', confirm: true }, { name: 'Elixir', badge: '傳說', fresh: true, confirm: true }],
    perks: { reroll: 2 } });
  await expect(page.locator('.pk-card[data-ro-recommended="true"] .pk-name')).toHaveText('Elixir');
  await expect(page.locator('#current .reason')).toContainText('清單內品質優先');
  await enable(page);
  await expect.poll(async () => (await selections(page))[0]?.name).toBe('Elixir');
  expect(await page.evaluate(() => (window as any).confirmAttempts)).toEqual([2]);
  expect(await perks(page)).toEqual([]);
  await expect(page.locator('#picker')).toHaveClass(/hidden/);
  await round(page, { title: '寶箱', gain: false,
    cards: [{ name: 'Elixir +8', badge: '傳說' }, { name: 'Potion +1', badge: '傳說' }] });
  await expect.poll(async () => (await selections(page))[1]?.name).toBe('Potion +1');
});

test('chest confirms only the selected item once, including repeated identical rounds', async ({ page }) => {
  await page.getByRole('button', { name: '寶箱道具', exact: true }).click(); await add(page, 'Elixir');
  const chest = { title: '寶箱', gain: false, cards: [{ name: 'Potion', badge: '傳說', confirm: true }, { name: 'Elixir +2', badge: '普通', confirm: true }] };
  await round(page, { ...chest, next: chest }); await enable(page);
  await expect.poll(async () => (await selections(page)).length).toBe(2);
  expect((await selections(page)).map(x => x.index)).toEqual([1, 1]);
  expect(await page.evaluate(() => (window as any).clickAttempts)).toEqual([1, 1]);
  expect(await page.evaluate(() => (window as any).confirmAttempts)).toEqual([1, 1]);
});

test('chest rarity fallback is independent and recognizes all observed chest titles', async ({ page }) => {
  await page.locator('#chest-fallback').check();
  await enable(page);
  for (const title of ['寶箱', 'Treasure chest', 'Cofre del tesoro', 'Baú do tesouro']) {
    await round(page, { title, gain: false, cards: [{ name: 'Elixir', badge: '傳說', fresh: true }, { name: 'Potion +2', badge: '普通' }] });
    await expect(page.locator('#picker')).toHaveClass(/hidden/);
  }
  expect((await selections(page)).map(x => x.name)).toEqual(['Elixir', 'Elixir', 'Elixir', 'Elixir']);
  await round(page); await page.waitForTimeout(1200); expect(await selections(page)).toHaveLength(4);
  await round(page, { title: '寶箱', gain: false, cards: [{ name: 'A', badge: '未知' }] });
  await expect(page.locator('#status')).toContainText('未知稀有度');
  await page.waitForTimeout(1200); expect(await selections(page)).toHaveLength(4);
});

for (const intervention of ['pause', 'manual cancel', 'settings change', 'new round'] as const) {
  test(`chest replacement is cancelled on ${intervention}`, async ({ page }) => {
    await page.getByRole('button', { name: '寶箱道具', exact: true }).click(); await add(page, 'Elixir');
    await round(page, { title: '寶箱', gain: false, cards: [{ name: 'Elixir', badge: '普通', confirm: true }] }); await enable(page);
    // Confirmation is transient; wait per animation frame rather than assertion
    // backoff intervals, which can miss it now that the preceding wait is random.
    await page.waitForFunction(() => !!document.querySelector('.pk-slot.asking'), null, { polling: 'raf', timeout: 5000 });
    if (intervention === 'pause') await page.getByRole('checkbox', { name: '自動選牌', exact: true }).uncheck();
    else if (intervention === 'manual cancel') await page.getByRole('button', { name: '不要替換' }).click();
    else if (intervention === 'settings change') await page.getByRole('button', { name: '移除 Elixir' }).click();
    else await round(page, { title: '劇情物品', gain: false, cards: [{ name: 'Elixir', badge: '普通', confirm: true }] });
    await page.waitForTimeout(1500);
    expect(await selections(page)).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).confirmAttempts)).toEqual([]);
  });
}

test('replacement can be disabled, and a rejected confirmation pauses without retry', async ({ page }) => {
  await page.getByRole('button', { name: '寶箱道具', exact: true }).click(); await add(page, 'Elixir');
  await page.locator('#chest-replace').uncheck();
  const chest = { title: '寶箱', gain: false, cards: [{ name: 'Elixir', badge: '普通', confirm: true }] };
  await round(page, chest); await enable(page);
  await expect(page.locator('#status')).toContainText('需要替換確認');
  await page.waitForTimeout(1200); expect(await page.evaluate(() => (window as any).clickAttempts)).toEqual([]);
  await page.locator('#chest-replace').check();
  await round(page, { ...chest, rejectConfirmation: true });
  await expect(page.locator('#status')).toContainText('遊戲未確認選牌');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).confirmAttempts)).toEqual([0]);
});
test('game rejection stops automation instead of repeated clicking', async ({ page }) => {
  await add(page, 'Fire Bolt'); await round(page, { reject: true }); await enable(page);
  await expect(page.locator('#status')).toContainText('遊戲未確認選牌');
  await expect(page.getByRole('checkbox', { name: '自動選牌', exact: true })).not.toBeChecked();
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(1);
});
test('captures names safely, isolates keyboard input, supports profiles and reordering', async ({ page }) => {
  await round(page, { cards: [{ name: '<img src=x onerror=alert(1)>', badge: '普通' }, { name: 'Fire Bolt', badge: '優良' }] });
  await page.getByRole('button', { name: '加入 Fire Bolt 到清單', exact: true }).click();
  await expect(page.locator('#priorities .name')).toHaveText(['Fire Bolt']);
  await page.getByRole('textbox', { name: '卡牌名稱', exact: true }).pressSequentially('123');
  expect(await page.evaluate(() => (window as any).keyEvents)).toEqual([]);
  expect(await page.locator('#current img').count()).toBe(0);
  await page.getByRole('button', { name: '管理清單', exact: true }).click();
  await page.getByRole('textbox', { name: '清單名稱', exact: true }).fill('法師');
  await page.getByRole('button', { name: '新增清單', exact: true }).click();
  await expect(page.locator('#priorities .name')).toHaveCount(0);
  await add(page, 'Heal'); await page.locator('#profiles').selectOption('default');
  await expect(page.locator('#priorities .name')).toHaveText(['Fire Bolt']);
});
test('Portuguese/English/Spanish titles and coop timer are recognized', async ({ page }) => {
  await add(page, 'Fire Bolt'); await enable(page);
  for (const title of ['Subiu de nível!', 'Level Up!', '¡Level Up!']) {
    await round(page, { title, timer: true });
    await expect(page.locator('#timer')).toContainText('逾時可能自行選牌');
    await expect(page.locator('#picker')).toHaveClass(/hidden/);
  }
  expect(await selections(page)).toHaveLength(3);
});

test('toolbar popup loads from the installed extension with minimal permissions', async ({ context, page }) => {
  const manager = await context.newPage();
  await manager.goto('chrome://extensions/');
  const item = manager.locator('extensions-item').filter({ hasText: 'RO 選牌助手' });
  await expect(item).toBeVisible();
  const id = await item.getAttribute('id');
  expect(id).toMatch(/^[a-p]{32}$/);
  const popup = await context.newPage();
  const errors: string[] = [];
  popup.on('pageerror', error => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByRole('heading', { name: /選牌助手/ })).toBeVisible();
  // A standalone popup tab is not the game, so the disconnected state is expected.
  await expect(popup.locator('#status')).toContainText('請切到 RO Survivors');
  expect(errors).toEqual([]);
  const permissions = await popup.evaluate(() => (window as any).chrome.runtime.getManifest().permissions);
  expect(permissions).toEqual(['storage']);
  await page.bringToFront();
  const tabs = await popup.evaluate(() => (window as any).chrome.tabs.query({ active: true, currentWindow: true }));
  const gameTabId = tabs[0].id;
  const result = await popup.evaluate(async tabId => (window as any).chrome.tabs.sendMessage(tabId, { type: 'RO_PICKER_STATUS' }), gameTabId);
  expect(result.enabled).toBe(false);
  await popup.evaluate(async tabId => (window as any).chrome.tabs.sendMessage(tabId, { type: 'RO_PICKER_SHOW' }), gameTabId);
  await expect(page.locator('#panel')).toBeVisible();
});

test('random delay defaults to 500–1500 ms and saves editable bounds', async ({ page }) => {
  await page.locator('#advanced summary').click();
  await expect(page.locator('#delay-min')).toHaveValue('500');
  await expect(page.locator('#delay-max')).toHaveValue('1500');
  await page.locator('#delay-min').fill('900'); await page.locator('#delay-min').blur();
  await page.locator('#delay-max').fill('1300'); await page.locator('#delay-max').blur();
  await page.reload(); await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
  await page.locator('#advanced summary').click();
  await expect(page.locator('#delay-min')).toHaveValue('900');
  await expect(page.locator('#delay-max')).toHaveValue('1300');
  await page.locator('#delay-min').fill('1600'); await page.locator('#delay-min').blur();
  await expect(page.locator('#delay-max')).toHaveValue('1600');
});

test('random waiting survives frequent timer updates for both skill and chest rounds', async ({ page }) => {
  await add(page, 'Fire Bolt');
  await page.getByRole('button', { name: '寶箱道具', exact: true }).click(); await add(page, 'Potion');
  await enable(page);
  const ticker = await page.evaluate(() => window.setInterval(() => {
    const timer = document.getElementById('pk-timer')!;
    timer.textContent = `Remaining ${performance.now()}`;
  }, 35));
  try {
    for (const kind of ['levelup', 'chest', 'levelup', 'chest']) {
      const name = kind === 'chest' ? 'Potion' : 'Fire Bolt';
      await round(page, { title: kind === 'chest' ? '寶箱' : '升級！', gain: kind !== 'chest', timer: true, cards: [{ name, badge: '普通' }] });
      await expect(page.locator('#picker')).toHaveClass(/hidden/, { timeout: 3500 });
    }
    const picks = await selections(page);
    expect(picks.map(p => p.name)).toEqual(['Fire Bolt', 'Potion', 'Fire Bolt', 'Potion']);
    // One-card animation protection is 720 ms. Allow scheduler headroom above 1500 ms.
    for (const pick of picks) { expect(pick.elapsedMs).toBeGreaterThanOrEqual(710); expect(pick.elapsedMs).toBeLessThan(2500); }
    expect(await page.evaluate(() => (window as any).clickAttempts.length)).toBe(4);
  } finally { await page.evaluate(id => clearInterval(id), ticker); }
});
