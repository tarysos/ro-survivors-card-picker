import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function executablePath(): string | undefined {
  if (process.env.RO_CHROMIUM_PATH) return process.env.RO_CHROMIUM_PATH;
  if (existsSync(chromium.executablePath())) return undefined;
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (existsSync(base)) {
    for (const folder of readdirSync(base).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const path = join(base, folder, 'chrome-win64', 'chrome.exe');
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}
export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'ro-picker-test-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, {
      headless: true, executablePath: executablePath(), viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const fixture = await readFile('tests/fixture.html', 'utf8');
    await context.route('https://ro-survivors.com/**', route => route.fulfill({ body: fixture, contentType: 'text/html' }));
    try { await use(context); } finally {
      await context.close();
      const target = resolve(profile);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('ro-picker-test-')) throw new Error('Unexpected test profile cleanup path');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto('https://ro-survivors.com/__extension_fixture__');
    await expect(page.locator('#ro-picker-assistant')).toBeAttached();
    await page.getByRole('button', { name: '開啟 RO 選牌助手' }).click();
    await use(page);
  },
});
