import { visible } from './adapter';
import { readRunScreen } from './run-adapter';
import type { Settings } from './types';

type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
type Point = { x: number; y: number };
type MapPosition = { point: Point; area: string };
const directions: Direction[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const opposite: Record<Direction, Direction> = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft', ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp' };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const manualPauseMs = 10_000;
const editingSelector = 'input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

function minimapPosition(): MapPosition | null {
  const coords = document.getElementById('minimap-coords');
  const area = document.getElementById('minimap-name')?.textContent?.trim();
  const match = coords?.textContent?.trim().match(/^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
  if (!area || !match || !visible(coords)) return null;
  return { point: { x: Number(match[1]), y: Number(match[2]) }, area };
}

export class LocalWalk {
  enabled = false;
  status = '走動尚未啟用';
  private origin: MapPosition | null = null;
  private direction: Direction = 'ArrowUp';
  private returning = false;
  private returnDirection: Direction = 'ArrowDown';
  private targetDistance = 1;
  private previousStep: Point | null = null;
  private lastDirection: Direction = 'ArrowUp';
  private bestReturnDistance = Infinity;
  private stalled = 0;
  private nextStep = 0;
  private held: Direction | null = null;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private watchFrame = 0;
  private interval?: ReturnType<typeof setInterval>;
  private manualKeys = new Set<string>();
  private manualPointers = new Set<number>();
  private resumeAt: number | null = null;

  private get manualHeld(): boolean { return this.manualKeys.size > 0 || this.manualPointers.size > 0; }

  constructor(private settings: Settings, private changed: () => void) {
    // Release before the game receives a real keydown, even if it is the same key we held.
    window.addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      const target = event.composedPath()[0];
      if (target instanceof Element && target.matches(editingSelector)) return;
      if (event.isTrusted && ['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        this.manualKeys.add(key);
        this.manualInputChanged();
      }
    }, true);
    window.addEventListener('keyup', event => {
      if (event.isTrusted && this.manualKeys.delete(event.key.toLowerCase())) this.manualInputChanged();
    }, true);
    window.addEventListener('pointerdown', event => {
      if (event.isTrusted && event.target instanceof Element && event.target.closest('#stage, #touch-ui')) {
        this.manualPointers.add(event.pointerId);
        this.manualInputChanged();
      }
    }, true);
    const endPointer = (event: PointerEvent) => {
      if (event.isTrusted && this.manualPointers.delete(event.pointerId)) this.manualInputChanged();
    };
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    window.addEventListener('pointermove', event => {
      if (event.buttons === 0) endPointer(event);
    }, true);
    const leavePage = () => {
      if (this.manualHeld) {
        this.manualKeys.clear();
        this.manualPointers.clear();
        this.manualInputChanged();
      }
      this.rest();
    };
    window.addEventListener('blur', leavePage);
    window.addEventListener('pagehide', () => this.stop());
    document.addEventListener('visibilitychange', () => { if (document.hidden) leavePage(); });
  }
  updateSettings(settings: Settings): void {
    if (settings.walkRadius !== this.settings.walkRadius || settings.walkIntervalMs !== this.settings.walkIntervalMs) {
      this.settings = settings;
      if (this.enabled) {
        this.release();
        this.nextStep = performance.now() + settings.walkIntervalMs;
      }
    } else this.settings = settings;
  }
  start(): void {
    if (this.enabled) return;
    if (this.manualHeld || readRunScreen().kind !== 'battle' || this.blocked()) {
      this.setStatus('請在戰鬥畫面放開移動鍵後啟用'); return;
    }
    this.origin = minimapPosition();
    if (!this.origin) { this.setStatus('請先在戰鬥中顯示小地圖座標'); return; }
    this.enabled = true;
    this.newExcursion();
    this.nextStep = performance.now() + this.settings.walkIntervalMs;
    this.setStatus('已記住起點，等待下一步');
    this.interval = setInterval(() => this.tick(), 80);
  }
  stop(message = '走動已停止'): void {
    this.release();
    clearInterval(this.interval);
    this.origin = null;
    this.resumeAt = null;
    this.enabled = false;
    this.setStatus(message);
  }
  private setStatus(message: string): void {
    if (this.status !== message) { this.status = message; this.changed(); }
  }
  private manualInputChanged(): void {
    if (!this.enabled) return;
    this.release();
    this.resumeAt = performance.now() + manualPauseMs;
  }
  private blocked(): boolean {
    const focus = document.activeElement;
    return document.visibilityState !== 'visible' || !document.hasFocus()
      || !!focus?.matches(editingSelector)
      || visible(document.getElementById('picker')) || visible(document.getElementById('party-wait'));
  }
  private release(): void {
    clearTimeout(this.releaseTimer);
    cancelAnimationFrame(this.watchFrame);
    if (this.held) window.dispatchEvent(new KeyboardEvent('keyup', { key: this.held, code: this.held, bubbles: true }));
    this.held = null;
  }
  private rest(message = '走動暫停 · 返回戰鬥後繼續'): void {
    if (!this.enabled) return;
    this.release();
    this.nextStep = performance.now() + this.settings.walkIntervalMs;
    this.setStatus(message);
  }
  private newExcursion(avoid?: Direction): void {
    const choices = directions.filter(direction => direction !== avoid);
    this.direction = choices[Math.floor(Math.random() * choices.length)];
    this.returnDirection = opposite[this.direction];
    this.targetDistance = 1 + Math.floor(Math.random() * (this.settings.walkRadius - 1));
    this.returning = false; this.previousStep = null; this.stalled = 0; this.bestReturnDistance = Infinity;
  }
  private tick(): void {
    if (!this.origin) return;
    const screen = readRunScreen();
    if (['settlement', 'lobby', 'stages', 'loading'].includes(screen.kind)) { this.stop('已離開戰鬥，走動已停止'); return; }
    if (screen.kind !== 'battle' || this.blocked()) { this.rest(); return; }
    const pos = minimapPosition();
    if (!pos) { this.rest('走動暫停 · 等待小地圖座標'); return; }
    if (pos.area !== this.origin.area) { this.stop('已離開原區域，走動已停止'); return; }
    if (this.resumeAt !== null) {
      if (this.manualHeld) { this.setStatus('手動移動中 · 放開後 10 秒恢復走動'); return; }
      const remaining = this.resumeAt - performance.now();
      if (remaining > 0) {
        this.setStatus(`手動移動已結束 · ${Math.ceil(remaining / 1000)} 秒後恢復走動`); return;
      }
      this.origin = pos;
      this.newExcursion();
      this.nextStep = 0;
      this.resumeAt = null;
    }
    const away = distance(this.origin.point, pos.point);
    if (away > this.settings.walkRadius) {
      // A single pulse can cross two integer coordinates diagonally. Undo that step
      // only when it started inside the circle; never chase a teleport or knockback.
      const previous = this.previousStep;
      this.release();
      if (!previous || distance(this.origin.point, previous) > this.settings.walkRadius || distance(previous, pos.point) > Math.SQRT2) {
        this.rest('走動暫停 · 超出活動半徑，等待回到範圍內'); return;
      }
      this.returning = true;
      this.returnDirection = opposite[this.lastDirection];
      this.bestReturnDistance = away;
    }
    if (performance.now() < this.nextStep) return;
    if (this.returning && away === 0) this.newExcursion();
    else if (!this.returning && away >= this.targetDistance) {
      this.returning = true; this.bestReturnDistance = away; this.stalled = 0;
    } else if (this.previousStep && away <= this.settings.walkRadius) {
      if (this.returning && this.settings.walkRadius - away < 1 && away > distance(this.origin.point, this.previousStep)) {
        this.returnDirection = opposite[this.lastDirection];
      }
      const progressed = this.returning ? away < this.bestReturnDistance : distance(this.previousStep, pos.point) > 0;
      this.stalled = progressed ? 0 : this.stalled + 1;
      if (this.returning) this.bestReturnDistance = Math.min(this.bestReturnDistance, away);
      if (this.stalled >= 4) {
        this.retryBlockedStep(away);
        return;
      }
    }
    this.previousStep = pos.point;
    this.nextStep = performance.now() + this.settings.walkIntervalMs;
    this.takeStep(this.returning ? this.returnDirection : this.direction, pos);
    this.setStatus(`${this.returning ? '往起點走' : '小步走動中'} · 起點 (${this.origin.point.x}, ${this.origin.point.y})`);
  }
  private retryBlockedStep(away: number): void {
    if (away === 0) this.newExcursion(this.direction);
    else {
      // Only probe a different return path if there is room inside the circle.
      if (this.returning && this.settings.walkRadius - away >= 1) {
        const turns = directions.filter(key => key !== this.returnDirection && key !== this.direction);
        this.returnDirection = turns[Math.floor(Math.random() * turns.length)];
      } else this.returnDirection = opposite[this.direction];
      this.returning = true;
      this.previousStep = null; this.stalled = 0; this.bestReturnDistance = away;
    }
    this.nextStep = performance.now() + Math.max(1000, this.settings.walkIntervalMs);
    this.setStatus('走動受阻 · 稍後重試');
  }
  private takeStep(key: Direction, pos: MapPosition): void {
    this.release();
    this.held = key;
    this.lastDirection = key;
    this.releaseTimer = setTimeout(() => this.release(), 100);
    // End fast characters' pulses on the first observed coordinate change.
    const watch = () => {
      if (!this.held) return;
      const latest = minimapPosition();
      if (!latest || latest.area !== pos.area || distance(pos.point, latest.point) >= 1 || this.blocked()) this.release();
      else this.watchFrame = requestAnimationFrame(watch);
    };
    this.watchFrame = requestAnimationFrame(watch);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: this.held, code: this.held, bubbles: true }));
  }
}
