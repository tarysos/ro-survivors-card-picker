import { visible } from './adapter';
import { normalizeName, readRarity, sampleDelay } from './core';
import type { Settings } from './types';

interface Loot { button: HTMLButtonElement; signature: string; name: string; readyAt: number; delay: number; handled: boolean }
/** Dismiss only an equipment acquisition notice; never make a group loot roll. */
export class LootCollector {
  private current: Loot | null = null;
  private attempt: { loot: Loot; at: number } | null = null;
  constructor(private log: (text: string) => void, private fail: (text: string) => void) {}
  defer(): void { if (this.current && !this.current.handled) this.current.readyAt = performance.now() + this.current.delay; }
  manual(): void { if (this.current) this.current.handled = true; }
  tick(settings: Settings, enabled: boolean): string | null {
    const root = document.getElementById('drop-reveal');
    const shown = visible(root);
    const button = shown ? root.querySelector<HTMLButtonElement>('button.dr-get') : null;
    const name = shown ? root.querySelector('.dr-name')?.textContent?.trim() ?? '' : '';
    const badge = shown ? root.querySelector('.dr-q')?.textContent?.trim() ?? '' : '';
    const signature = JSON.stringify([name, badge, button?.textContent]);
    if (this.attempt) {
      if (!shown || button !== this.attempt.loot.button || signature !== this.attempt.loot.signature) {
        this.log(`已點擊取得「${this.attempt.loot.name}」`); this.attempt = null;
      } else if (performance.now() - this.attempt.at > 1500) {
        this.attempt = null; this.fail('遊戲未確認裝備取得，已暫停。請手動檢查提示。');
      }
    }
    if (!shown) { this.current = null; return null; }
    const isEquipment = readRarity(badge.split('·')[0].trim(), false) !== null;
    const supported = button && visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
      && !root.classList.contains('roll') && !root.querySelector('.dr-roll, [data-c], .dr-result')
      && ['取得', 'get', 'coger', 'pegar'].includes(normalizeName(button.textContent ?? '')) && isEquipment && !!name;
    if (!supported) { this.current = null; return '掉落提示保留手動操作'; }
    if (this.current?.button !== button || this.current.signature !== signature) {
      const delay = Math.max(750, sampleDelay(settings));
      this.current = { button, name, signature, delay, readyAt: performance.now() + delay, handled: false };
    }
    if (this.attempt) return '等待遊戲確認裝備取得';
    if (this.current.handled) return '裝備提示已處理 · 等待關閉';
    if (!enabled || !settings.autoCollectLoot) return '裝備取得提示 · 自動取得尚未啟用';
    if (document.visibilityState !== 'visible') { this.defer(); return '分頁在背景 · 返回後取得裝備'; }
    if (performance.now() >= this.current.readyAt) {
      this.current.handled = true; this.attempt = { loot: this.current, at: performance.now() };
      button.click();
      return '等待遊戲確認裝備取得';
    }
    return `即將取得「${name}」`;
  }
}
