import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

let executablePath = process.env.RO_CHROMIUM_PATH;
if (!executablePath && !existsSync(chromium.executablePath())) {
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (existsSync(base)) {
    executablePath = readdirSync(base).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()
      .map(x => join(base, x, 'chrome-win64', 'chrome.exe')).find(existsSync);
  }
}
const profile = await mkdtemp(join(tmpdir(), 'ro-picker-smoke-'));
const extension = resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  headless: true, executablePath, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://ro-survivors.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click({ timeout: 20000 });
  await page.locator('#panel').waitFor({ state: 'visible' });
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/live-home.png' });
  const result = {
    checkedAt: new Date().toISOString(), url: page.url(), title: await page.title(),
    panelVisible: await page.locator('#panel').isVisible(),
    status: await page.locator('#ro-picker-assistant').locator('#status').textContent(),
    pageErrors: errors,
    limitation: 'Read-only live homepage check in a fresh profile; no account login or real in-game choice performed.',
  };
  await writeFile('artifacts/live-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  const target = resolve(profile);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('ro-picker-smoke-')) throw new Error('Unexpected smoke profile cleanup path');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
