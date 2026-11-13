import { visible } from './adapter';
import { normalizeName, sampleDelay } from './core';
import { rollCategory, rollCategories, rollChoiceLabels } from './roll-rules';
import type { Settings } from './types';

interface LootAction {
  button: HTMLButtonElement;
  signature: string;
  description: string;
  isRoll: boolean;
  enabled: boolean;
}

function readLootAction(root: HTMLElement, settings: Settings): LootAction | null {
  const name = root.querySelector('.dr-name')?.textContent?.trim();
  const badge = normalizeName(root.querySelector('.dr-q')?.textContent?.split('·')[0] ?? '');
  const artwork = root.querySelector<HTMLImageElement>('.dr-card img')?.getAttribute('src') ?? '';
  if (root.classList.contains('roll')) {
    const choices = root.querySelector('.dr-roll .dr-roll-btns');
    if (!name || root.querySelector('.dr-result') || !choices) return null;
    const baseStats = Array.from(root.querySelectorAll('.dr-stats > li > b'), el => el.textContent.trim());
    const category = rollCategory(artwork, badge, baseStats);
    const choice = settings.rollRules[category];
    const button = choices.querySelector<HTMLButtonElement>(`button[data-c="${choice}"]`);
    if (!button) return null;
    return {
      button, description: `「${name}」（${rollCategories[category]}）選 ${rollChoiceLabels[choice]}`,
      signature: JSON.stringify([name, badge, artwork, category, choice]), isRoll: true, enabled: settings.autoRollLoot,
    };
  }
  const button = root.querySelector<HTMLButtonElement>('button.dr-get');
  if (!button || root.querySelector('.dr-roll, [data-c]')
    || !['取得', 'get', 'coger', 'pegar'].includes(normalizeName(button.textContent ?? ''))) return null;
  return {
    button, description: name ? `取得「${name}」` : '取得掉落物',
    signature: JSON.stringify([name, badge, artwork, button.textContent]), isRoll: false, enabled: settings.autoCollectLoot,
  };
}

export class LootCollector {
  private current: { button: HTMLButtonElement; signature: string; readyAt: number; delay: number } | null = null;
  private handled: Element | null = null;
  private handledSignature = '';
  private attempt: { action: LootAction; at: number } | null = null;
  constructor(private log: (text: string) => void, private fail: (text: string) => void) {}
  defer(): void {
    if (this.current) this.current.readyAt = performance.now() + this.current.delay;
  }
  manual(): void {
    const root = document.getElementById('drop-reveal');
    this.handled = root?.querySelector('.dr-roll, button.dr-get') ?? null;
    this.handledSignature = this.current?.signature ?? '';
  }
  tick(settings: Settings, enabled: boolean): string | null {
    const root = document.getElementById('drop-reveal');
    const shown = visible(root);
    const action = shown ? readLootAction(root, settings) : null;
    const now = performance.now();
    if (this.attempt) {
      const { action: submitted, at } = this.attempt;
      // The game closes this reveal or replaces its buttons when it advances the queue.
      const changedPickup = !submitted.isRoll && action?.signature !== submitted.signature;
      if (!shown || !root.contains(submitted.button) || changedPickup) {
        this.log(`已${submitted.isRoll ? '為' : '點擊'}${submitted.description}`);
        this.attempt = null;
      } else if (now - at > 1500) {
        this.attempt = null;
        this.fail(`遊戲未確認${submitted.isRoll ? '組隊分寶' : submitted.description}，已暫停。請手動檢查提示。`);
      } else return submitted.isRoll ? '等待遊戲確認組隊分寶' : `等待遊戲確認${submitted.description}`;
    }
    if (!shown) { this.current = null; this.handled = null; return null; }
    if (!action || !visible(action.button) || action.button.disabled || action.button.getAttribute('aria-disabled') === 'true') {
      this.current = null;
      return '掉落提示保留手動操作';
    }
    const reveal = action.button.closest('.dr-roll') ?? action.button;
    if (this.handled === reveal && (action.isRoll || !this.handledSignature || this.handledSignature === action.signature)) return '本件掉落已處理 · 等待關閉';
    if (this.current?.button !== action.button || this.current.signature !== action.signature) {
      const delay = Math.max(750, sampleDelay(settings));
      this.current = { button: action.button, signature: action.signature, delay, readyAt: now + delay };
    }
    if (!action.enabled) return action.isRoll ? '組隊分寶 · 手動擲骰' : '自動取得尚未啟用';
    if (!enabled) return `預覽 · ${action.description}`;
    if (document.visibilityState !== 'visible') { this.defer(); return '分頁在背景 · 返回後繼續'; }
    if (now < this.current.readyAt) return `即將${action.isRoll ? '為' : ''}${action.description}`;
    this.handled = reveal;
    this.handledSignature = action.signature;
    this.attempt = { action, at: now };
    action.button.click();
    return action.isRoll ? '等待遊戲確認組隊分寶' : `等待遊戲確認${action.description}`;
  }
}
