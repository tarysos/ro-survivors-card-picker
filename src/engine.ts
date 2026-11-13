import { decideSnapshot, minimumDelay, normalizeName, planPerk, sampleDelay } from './core';
import { readSnapshot, sameRound, visible } from './adapter';
import type { PerkPlan, Settings, Snapshot, ViewState } from './types';

export class PickerEngine {
  private settings: Settings;
  private round: Snapshot | null = null;
  private readyAt = 0;
  private sampledDelayMs = 0;
  private handled = false;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private queued = false;
  private observer: MutationObserver;
  private observed: HTMLElement | null = null;
  private attempt: { snapshot: Snapshot; index: number; at: number; acknowledged: boolean; reason: string; phase: 'opening' | 'submitted'; sawConfirmation: boolean } | null = null;
  private error = '';
  private perkAttempt: { snapshot: Snapshot; plan: PerkPlan; at: number } | null = null;
  private listeners = new Set<(state: ViewState) => void>();
  state: ViewState = { enabled: false, status: '預覽模式 · 自動選牌尚未啟用', recommendation: { index: null, reason: '' }, snapshot: null, logs: [] };

  constructor(settings: Settings) {
    this.settings = settings;
    this.observer = new MutationObserver(() => this.queue());
    // A low-frequency reconnect watchdog handles a replaced picker without watching the entire game's HUD.
    setInterval(() => this.queue(), 500);
    document.addEventListener('visibilitychange', () => this.queue());
    document.addEventListener('click', event => {
      const target = event.target;
      if (event.isTrusted && target instanceof Element && target.closest('#picker .pk-card, #picker .pk-act, #picker [data-yes], #picker [data-no]')) this.manualIntervention();
    }, true);
    window.addEventListener('keydown', event => {
      if (event.isTrusted && !event.composedPath().some(node => node instanceof HTMLElement && node.id === 'ro-picker-assistant') && this.round && /^(?:[1-9]|Enter| )$/.test(event.key)) this.manualIntervention();
    }, true);
    this.queue();
  }
  subscribe(listener: (state: ViewState) => void): () => void {
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private emit(): void { this.listeners.forEach(listener => listener(this.state)); }
  private log(text: string): void {
    this.state.logs.unshift({ time: new Date().toLocaleTimeString('zh-TW', { hour12: false }), text });
    this.state.logs.length = Math.min(this.state.logs.length, 30);
  }
  private cancel(): void { clearTimeout(this.pending); this.pending = undefined; }
  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.tick(); });
  }
  setEnabled(enabled: boolean): void {
    this.cancel(); this.error = ''; this.state.enabled = enabled;
    if (!enabled) this.abandonConfirmation();
    if (enabled && this.round) this.readyAt = performance.now() + minimumDelay(this.round.cards.length, this.sampledDelayMs);
    this.log(enabled ? '已啟用自動選牌（僅此分頁）' : '已暫停自動選牌');
    this.queue();
  }
  updateSettings(settings: Settings): void {
    // Own storage notifications do not restart or cancel a pending selection.
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    const delayChanged = settings.delayMinMs !== this.settings.delayMinMs || settings.delayMaxMs !== this.settings.delayMaxMs;
    this.abandonConfirmation();
    this.cancel(); this.settings = settings;
    if (this.round) {
      if (delayChanged) this.sampledDelayMs = sampleDelay(settings);
      this.readyAt = performance.now() + minimumDelay(this.round.cards.length, this.sampledDelayMs);
    }
    this.queue();
  }
  pauseWithError(message: string): void {
    this.abandonConfirmation();
    this.cancel(); this.state.enabled = false; this.error = message; this.log(message); this.queue();
  }
  clearLogs(): void { this.state.logs = []; this.emit(); }
  private manualIntervention(): void {
    this.perkAttempt = null;
    this.abandonConfirmation();
    this.cancel(); this.handled = true;
    this.state.status = '本輪已交由你手動操作'; this.emit();
  }
  private abandonConfirmation(): void {
    if (this.attempt?.phase === 'opening') { this.attempt = null; this.cancel(); }
  }
  private canReplace(snapshot: Snapshot): boolean {
    return snapshot.kind === 'chest' && this.settings.chestAutoReplace;
  }
  private confirmReplacement(next: Snapshot | null): void {
    const attempt = this.attempt!;
    const card = attempt.snapshot.cards[attempt.index];
    if (!this.state.enabled || document.visibilityState !== 'visible' || !next || !sameRound(next, attempt.snapshot) || !this.canReplace(next) || next.closing || decideSnapshot(next, this.settings).index !== attempt.index) {
      this.abandonConfirmation(); this.queue(); return;
    }
    const slot = card.element.closest('.pk-slot');
    const asking = !!slot?.classList.contains('asking');
    if (attempt.sawConfirmation && !asking) { this.abandonConfirmation(); this.queue(); return; }
    attempt.sawConfirmation ||= asking;
    const elapsed = performance.now() - attempt.at;
    const button = slot?.querySelector<HTMLButtonElement>('.pk-back [data-yes]');
    if (asking && elapsed >= 450 && button && !button.disabled && visible(button)) {
      attempt.phase = 'submitted'; attempt.at = performance.now();
      this.cancel(); button.click(); this.queue();
      setTimeout(() => this.queue(), 550);
    } else if (elapsed >= 2000) {
      this.pauseWithError('寶箱替換確認未就緒，已暫停。請手動選擇。');
    } else {
      this.state.status = `即將確認替換「${card.name}」`;
      this.cancel(); this.pending = setTimeout(() => this.queue(), 100); this.emit();
    }
  }
  private tick(): void {
    const root = document.getElementById('picker');
    if (root !== this.observed) {
      this.observer.disconnect(); this.observed = root;
      if (root) this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled', 'hidden', 'style'] });
    }
    const next = readSnapshot();
    this.state.snapshot = next;
    if (this.perkAttempt) {
      const { snapshot, plan, at } = this.perkAttempt;
      const currentActions = next ? [next.reroll, ...next.cards.flatMap(c => Object.values(c.actions))] : [];
      const spent = next?.root === snapshot.root && next.kind === snapshot.kind && currentActions.some(a => a?.kind === plan.kind && a.left !== null && a.left < plan.action.left!);
      const removed = plan.kind === 'banish' && next?.root === snapshot.root && next.kind === snapshot.kind && !sameRound(snapshot, next) && !next.cards.some(c => normalizeName(c.name) === normalizeName(snapshot.cards[plan.cardIndex!].name));
      if (spent || removed) {
        this.log(`已${plan.description}`); this.perkAttempt = null;
      } else if (performance.now() - at >= 800) {
        this.perkAttempt = null; this.pauseWithError('遊戲未確認專注／放逐／重抽操作，已暫停，請檢查畫面。'); return;
      } else { this.state.status = `等待遊戲確認：${plan.description}`; this.emit(); return; }
    }
    if (this.attempt && !this.attempt.acknowledged) {
      const attempt = this.attempt;
      const card = attempt.snapshot.cards[attempt.index];
      if (card.element.closest('.pk-slot')?.classList.contains('chosen')) {
        attempt.acknowledged = true;
        this.log(`已選擇「${card.name}」｜${attempt.snapshot.kind === 'chest' ? '寶箱' : '技能'}｜${attempt.reason}`);
      } else if (attempt.phase === 'opening') {
        this.confirmReplacement(next); return;
      } else if (performance.now() - attempt.at >= 500) {
        this.attempt = null;
        this.pauseWithError('遊戲未確認選牌，已暫停。請手動選擇並檢查畫面。');
        return;
      } else {
        this.state.status = '等待遊戲確認選牌'; this.emit(); return;
      }
    }
    if (!next) {
      this.cancel(); this.round = null; this.handled = false;
      if (this.attempt?.acknowledged) this.attempt = null;
      this.state.recommendation = { index: null, reason: '' };
      this.state.status = this.error || (this.state.enabled ? '監看中 · 等待升級或寶箱選牌' : '預覽模式 · 自動選牌尚未啟用');
      this.emit(); return;
    }
    if (!this.round || !sameRound(this.round, next)) {
      this.cancel(); this.round = next; this.handled = false;
      if (this.attempt?.acknowledged) this.attempt = null;
      // Draw once per new set of cards; DOM/timer updates must not redraw or postpone it.
      this.sampledDelayMs = sampleDelay(this.settings);
      this.readyAt = performance.now() + minimumDelay(next.cards.length, this.sampledDelayMs);
    }
    this.state.recommendation = decideSnapshot(next, this.settings);
    const decision = this.state.recommendation;
    const perk = planPerk(next, this.settings);
    if (this.error) this.state.status = this.error;
    else if (next.kind !== 'levelup' && next.kind !== 'chest') this.state.status = `保留手動操作 · ${next.title || '未知選牌畫面'}`;
    else if (next.closing) this.state.status = '選牌完成 · 等待下一輪';
    else if (next.confirming || (!perk && decision.index !== null && next.cards[decision.index].requiresConfirmation && !this.canReplace(next))) this.state.status = '需要替換確認 · 請手動選擇';
    else if (this.handled) this.state.status = '本輪已處理 · 等待下一輪';
    else if (document.visibilityState !== 'visible') this.state.status = '分頁在背景 · 返回後繼續';
    else if (perk) {
      this.state.status = `${this.state.enabled ? '即將' : '預覽：'}${perk.description}`;
      this.cancel();
      if (this.state.enabled) this.pending = setTimeout(() => this.performPerk(next, perk), Math.max(0, this.readyAt - performance.now()));
      this.emit(); return;
    }
    else if (decision.index === null) this.state.status = decision.reason;
    else if (!this.state.enabled) this.state.status = `推薦「${next.cards[decision.index].name}」· 預覽模式`;
    else {
      const wait = Math.max(0, this.readyAt - performance.now());
      this.state.status = `即將選擇「${next.cards[decision.index].name}」`;
      this.cancel();
      const expected = next;
      this.pending = setTimeout(() => this.pick(expected, decision.index!), wait);
      this.emit(); return;
    }
    this.cancel(); this.emit();
  }
  private pick(expected: Snapshot, index: number): void {
    this.pending = undefined;
    const current = readSnapshot();
    if (!this.state.enabled || document.visibilityState !== 'visible' || this.handled || !current || !sameRound(expected, current) || (current.kind !== 'levelup' && current.kind !== 'chest') || current.closing || current.confirming) { this.queue(); return; }
    const decision = decideSnapshot(current, this.settings);
    if (planPerk(current, this.settings)) { this.queue(); return; }
    const card = current.cards[index];
    if (decision.index !== index || !card || (card.requiresConfirmation && !this.canReplace(current)) || card.element.disabled || !visible(card.element)) {
      this.pauseWithError('卡牌目前無法操作，已暫停。'); return;
    }
    this.handled = true;
    this.attempt = { snapshot: current, index, at: performance.now(), acknowledged: false, reason: decision.reason,
      phase: card.requiresConfirmation ? 'opening' : 'submitted', sawConfirmation: false };
    card.element.click();
    this.queue();
    setTimeout(() => this.queue(), 550);
  }
  private performPerk(expected: Snapshot, plan: PerkPlan): void {
    this.pending = undefined;
    const current = readSnapshot();
    if (!this.state.enabled || this.handled || document.visibilityState !== 'visible' || !current || !sameRound(expected, current) || current.closing || current.confirming) { this.queue(); return; }
    const latest = planPerk(current, this.settings);
    if (!latest || latest.kind !== plan.kind || latest.cardIndex !== plan.cardIndex || latest.action.element !== plan.action.element || latest.action.element.disabled || !visible(latest.action.element)) { this.queue(); return; }
    this.handled = true;
    this.perkAttempt = { snapshot: current, plan: latest, at: performance.now() };
    latest.action.element.click();
    this.queue(); setTimeout(() => this.queue(), 850);
  }
}
