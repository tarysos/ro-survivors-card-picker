import { normalizeName } from './core';
import { captainPrompt, departureButton, difficultyConfirmation, offlinePlayButton, readRunScreen, selectedStageName, stageChoices, usableButton, type RunScreen } from './run-adapter';

export interface LoopState { enabled: boolean; status: string; completed: number; logs: string[] }
type Expected = 'returned' | 'lobby' | 'stages' | 'selected' | 'difficulty' | 'battle';
interface Attempt { key: string; expected: Expected; at: number; timeout: number; label: string }

/** Only observed screen transitions acknowledge actions; timeouts never retry a click. */
export class RunLoop {
  state: LoopState = { enabled: false, status: '循環尚未啟用', completed: 0, logs: [] };
  private stageName: string;
  private listeners = new Set<(state: LoopState) => void>();
  private candidate: { key: string; button: HTMLButtonElement; at: number } | null = null;
  private attempt: Attempt | null = null;
  private ownDifficulty = false;
  private difficultyButton: HTMLButtonElement | null = null;
  private stalledAt = 0;
  private stalledKey = '';

  constructor(stageName: string) {
    this.stageName = stageName;
    setInterval(() => this.tick(), 250);
    document.addEventListener('visibilitychange', () => {
      this.candidate = null; this.stalledAt = performance.now();
      if (this.attempt) this.attempt.at = performance.now();
      this.tick();
    });
    document.addEventListener('click', event => {
      if (this.state.enabled && event.isTrusted && event.target instanceof Element && event.target.closest('#stages button, #npc-options button, #npc-text .lb-pick button, #btn-restart, #lobby-prompt, #lobby-switch')) {
        this.stop('已交由你操作，循環已暫停');
      }
    }, true);
    document.addEventListener('input', event => {
      if (this.state.enabled && event.isTrusted && event.target instanceof Element && event.target.closest('#npc-text .diff input')) this.stop('已交由你調整難度，循環已暫停');
    }, true);
    document.addEventListener('keydown', event => {
      if (this.state.enabled && event.isTrusted && ['Escape', 'Enter', ' '].includes(event.key)
        && !event.composedPath().some(node => node instanceof HTMLElement && node.id === 'ro-picker-assistant')
        && ['stages', 'dialog', 'lobbyChoice', 'settlement'].includes(readRunScreen().kind)) this.stop('已交由你操作，循環已暫停');
    }, true);
  }
  subscribe(listener: (state: LoopState) => void): void { this.listeners.add(listener); listener(this.state); }
  private status(text: string): void { this.state.status = text; this.listeners.forEach(listener => listener(this.state)); }
  private log(text: string): void {
    this.state.logs.unshift(`${new Date().toLocaleTimeString('zh-TW', { hour12: false })} ${text}`);
    this.state.logs.length = Math.min(12, this.state.logs.length);
  }
  updateStage(name: string): void {
    if (name === this.stageName) return;
    this.stageName = name;
    if (this.state.enabled) this.stop('目標關卡已變更，請重新啟用循環');
  }
  start(): void {
    if (!this.stageName.trim()) { this.stop('請先設定循環關卡'); return; }
    this.candidate = null; this.attempt = null; this.ownDifficulty = false; this.difficultyButton = null;
    this.stalledKey = ''; this.state.enabled = true;
    this.log(`啟用循環：${this.stageName}`); this.tick();
  }
  stop(message = '循環已暫停'): void {
    this.state.enabled = false; this.candidate = null; this.attempt = null; this.ownDifficulty = false; this.difficultyButton = null;
    this.log(message); this.status(message);
  }
  private matches(name: string): boolean { return normalizeName(name) === normalizeName(this.stageName); }
  private acknowledged(screen: RunScreen): boolean {
    switch (this.attempt?.expected) {
      case 'returned':
      case 'lobby': return screen.kind === 'lobby';
      case 'stages': return screen.kind === 'stages';
      case 'selected': return screen.kind === 'stages' && stageChoices().some(stage => stage.selected && this.matches(stage.name)) && this.matches(selectedStageName());
      case 'difficulty': return screen.kind === 'dialog';
      case 'battle': return screen.kind === 'battle';
      default: return false;
    }
  }
  private wait(key: string, message: string, timeout = 15000): void {
    this.candidate = null;
    if (key !== this.stalledKey) { this.stalledKey = key; this.stalledAt = performance.now(); }
    if (performance.now() - this.stalledAt >= timeout) this.stop(`${message}；等待逾時，循環已暫停`);
    else this.status(message);
  }
  private click(key: string, button: HTMLButtonElement, label: string, expected: Expected, delay = 750): void {
    this.stalledKey = '';
    if (this.candidate?.key !== key || this.candidate.button !== button) this.candidate = { key, button, at: performance.now() };
    if (performance.now() - this.candidate.at < delay) { this.status(`即將${label}`); return; }
    // Called only after re-reading and validating the current screen in this tick.
    this.candidate = null;
    this.attempt = { key, expected, at: performance.now(), timeout: ['battle', 'returned', 'lobby'].includes(expected) ? 90000 : 8000, label };
    this.log(label); this.status(`等待遊戲確認：${label}`);
    button.click();
  }
  private tick(): void {
    if (!this.state.enabled) return;
    if (document.visibilityState !== 'visible') {
      this.candidate = null; this.stalledAt = performance.now();
      if (this.attempt) this.attempt.at = performance.now();
      this.status('分頁在背景 · 返回後繼續循環'); return;
    }
    const screen = readRunScreen();
    if (screen.kind === 'blocked') { this.stop(`「${screen.label}」需要手動處理，循環已暫停`); return; }
    if (screen.kind === 'loot') { this.wait('loot', '等待掉落提示關閉', 90000); return; }
    if (screen.kind === 'lobbyChoice' && this.attempt?.key !== 'offline') {
      const button = offlinePlayButton(screen.root);
      if (button) {
        const expected = this.attempt?.expected === 'returned' ? 'returned' : 'lobby';
        this.click('offline', button, '選擇離線遊玩', expected);
      } else this.wait('offline', '等待「離線遊玩」按鈕就緒');
      return;
    }
    if (this.attempt) {
      if (this.acknowledged(screen)) {
        if (this.attempt.expected === 'returned') { this.state.completed++; this.log(`已結算 ${this.state.completed} 場，回到城鎮`); }
        if (this.attempt.expected === 'difficulty') { this.ownDifficulty = true; this.difficultyButton = difficultyConfirmation(); }
        if (this.attempt.expected === 'battle') { this.ownDifficulty = false; this.log(`已進入「${this.stageName}」`); }
        this.attempt = null; this.stalledKey = '';
      } else {
        if (screen.kind === 'dialog') { this.stop(`「${screen.label || '遊戲對話'}」需要手動處理，循環已暫停`); return; }
        if (performance.now() - this.attempt.at >= this.attempt.timeout) this.stop(`遊戲未確認「${this.attempt.label}」，循環已暫停`);
        else this.status(`等待遊戲確認：${this.attempt.label}`);
        return;
      }
    }
    if (screen.kind !== 'dialog') this.ownDifficulty = false;
    if (screen.kind === 'battle') {
      this.candidate = null; this.stalledKey = '';
      this.status(`戰鬥中 · 結算後前往「${this.stageName}」`); return;
    }
    if (screen.kind === 'settlement') {
      const button = usableButton('btn-restart');
      if (button) this.click('return', button, '完成結算並回城', 'returned', 2500);
      else this.wait('settlement', '等待結算按鈕就緒');
      return;
    }
    if (screen.kind === 'lobby') {
      const button = captainPrompt();
      if (button) this.click('captain', button, '與遠征隊長交談', 'stages');
      else this.wait('captain', '尚未找到隊長交談按鈕，請靠近遠征隊長');
      return;
    }
    if (screen.kind === 'stages') {
      const matches = stageChoices().filter(stage => this.matches(stage.name));
      if (matches.length !== 1) { this.stop(`找不到唯一的關卡「${this.stageName}」，請確認完整名稱`); return; }
      const target = matches[0];
      if (!target.available) { this.stop(`「${this.stageName}」尚未解鎖或未開放，循環已暫停`); return; }
      if (!target.selected || !this.matches(selectedStageName())) {
        this.click('select-stage', target.element, `選擇「${target.name}」`, 'selected'); return;
      }
      const button = departureButton();
      if (!button) { this.stop(`「${this.stageName}」目前無法出發，請先完成需求或劇情`); return; }
      this.click('depart', button, `從「${this.stageName}」出發`, 'difficulty'); return;
    }
    if (screen.kind === 'dialog') {
      const button = this.ownDifficulty ? difficultyConfirmation() : null;
      if (button && button === this.difficultyButton) this.click('difficulty', button, '沿用目前難度進入戰鬥', 'battle');
      else this.stop(`「${screen.label || '遊戲對話'}」需要手動處理，請返回關卡選單後重新啟用循環`);
      return;
    }
    this.wait(screen.kind, screen.kind === 'loading' ? '等待遊戲載入' : '等待城鎮、戰鬥或結算畫面', screen.kind === 'loading' ? 90000 : 15000);
  }
}
