import { visible } from './adapter';
import { normalizeName } from './core';

export interface StageChoice { name: string; element: HTMLButtonElement; available: boolean; selected: boolean }
export interface RunScreen {
  kind: 'loading' | 'loot' | 'settlement' | 'stages' | 'dialog' | 'lobbyChoice' | 'blocked' | 'lobby' | 'battle' | 'unknown';
  root: HTMLElement | null;
  label: string;
}
const byId = (id: string) => document.getElementById(id);
const labels = (values: string[], text: string) => values.some(value => normalizeName(value) === normalizeName(text));

export function readRunScreen(): RunScreen {
  const overlays = [...document.querySelectorAll<HTMLElement>('.overlay')].filter(visible);
  const blocking = overlays.find(el => !['loading', 'gameover', 'stages', 'npc-dialog', 'picker', 'drop-reveal'].includes(el.id));
  if (blocking) return { kind: 'blocked', root: blocking, label: blocking.querySelector('.ro-title')?.textContent?.trim() || '其他遊戲視窗' };
  if (visible(byId('drop-reveal'))) return { kind: 'loot', root: byId('drop-reveal'), label: '掉落提示' };
  for (const [id, kind] of [['loading', 'loading'], ['npc-dialog', 'dialog'], ['gameover', 'settlement'], ['stages', 'stages']] as const) {
    const root = byId(id);
    if (!visible(root)) continue;
    if (kind === 'dialog' && root.querySelector('#npc-text .lb-pick')
      && labels(['選擇大廳', 'Choose a lobby', 'Elige un lobby', 'Escolha um lobby'], root.querySelector('#npc-name')?.textContent ?? '')) {
      return { kind: 'lobbyChoice', root, label: '選擇大廳' };
    }
    return { kind, root, label: root.querySelector('.ro-title')?.textContent?.trim() ?? '' };
  }
  if (document.body.classList.contains('in-lobby') && visible(byId('lobby-ui'))) return { kind: 'lobby', root: byId('lobby-ui'), label: '城鎮' };
  if (!document.body.classList.contains('in-lobby') && visible(byId('hud'))) return { kind: 'battle', root: byId('hud'), label: '戰鬥' };
  return { kind: 'unknown', root: null, label: '' };
}

export function stageChoices(): StageChoice[] {
  if (!visible(byId('stages'))) return [];
  return [...document.querySelectorAll<HTMLButtonElement>('#stg-list button.stg-card')].map(element => ({
    element, name: element.querySelector('.stg-card-info b')?.textContent?.trim() ?? '',
    available: visible(element) && !element.disabled && !element.matches('.locked, .soon') && element.matches('.open, .cleared'),
    selected: element.classList.contains('sel'),
  })).filter(stage => stage.name);
}
export function selectedStageName(): string {
  return visible(byId('stages')) ? document.querySelector('#stg-detail .stg-banner-text b')?.textContent?.trim() ?? '' : '';
}
export function currentStageName(): string {
  if (readRunScreen().kind === 'stages') return selectedStageName();
  if (readRunScreen().kind === 'battle') return byId('minimap-name')?.textContent?.trim() ?? '';
  return '';
}
export function captainPrompt(): HTMLButtonElement | null {
  const button = byId('lobby-prompt');
  if (!(button instanceof HTMLButtonElement) || !visible(button) || button.disabled) return null;
  const clone = button.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('kbd').forEach(el => el.remove());
  return labels(['與隊長交談', 'Talk to the captain', 'Hablar con el capitán', 'Falar com o capitão'], clone.textContent ?? '') ? button : null;
}
export function departureButton(): HTMLButtonElement | null {
  return usableButton('stg-go');
}
export function offlinePlayButton(dialog: HTMLElement | null): HTMLButtonElement | null {
  const buttons = [...(dialog?.querySelectorAll<HTMLButtonElement>('#npc-options > button') ?? [])].filter(button =>
    visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
    && labels(['離線遊玩', 'Play offline', 'Jugar sin conexión', 'Jogar sem conexão'], button.textContent ?? ''));
  return buttons.length === 1 ? buttons[0] : null;
}
export function usableButton(id: string): HTMLButtonElement | null {
  const element = byId(id);
  return element instanceof HTMLButtonElement && visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' ? element : null;
}
export function difficultyConfirmation(): HTMLButtonElement | null {
  if (!visible(byId('npc-dialog')) || !labels(['難度', 'Difficulty', 'Dificultad', 'Dificuldade'], byId('npc-name')?.textContent ?? '')) return null;
  const controls = [...document.querySelectorAll<HTMLInputElement>('#npc-text .diff input[type="range"][data-key]')];
  const keys = controls.map(el => el.dataset.key).sort().join(',');
  if (keys !== 'count,damage,events,hp,speed' || controls.some(el => !Number.isFinite(el.valueAsNumber)) || document.querySelector('#npc-text [data-pick]')) return null;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#npc-options button.primary')].filter(el => visible(el) && !el.disabled);
  if (buttons.length !== 1) return null;
  return labels(['前往野外', 'Go to the field', 'Ir al campo', 'Ir para o campo'], buttons[0].textContent ?? '') ? buttons[0] : null;
}
