import { normalizeName, readRarity } from './core';
import type { Card, GameAction, Snapshot } from './types';

const text = (root: Element, selector: string): string => root.querySelector(selector)?.textContent?.trim() ?? '';
// The game uses .hidden to mark inactive metadata; responsive CSS separately hides
// active metadata on short/narrow screens. Only actionable elements need geometry.
function activeMetadata(root: Element, selector: string): boolean {
  const element = root.querySelector(selector);
  return !!element && !element.classList.contains('hidden') && !element.hasAttribute('hidden');
}
function readActions(root: Element | null): GameAction[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLButtonElement>('.pk-act')].flatMap(element => {
    // Read only the label, excluding the adjacent remaining-use counter.
    const label = normalizeName([...element.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent ?? '').join(''));
    const kind = ['focus', '專注'].includes(label) ? 'focus' : ['banish', '放逐'].includes(label) ? 'banish'
      : ['reroll deck', '重抽全部'].includes(label) ? 'reroll' : null;
    if (!kind) return [];
    const count = element.querySelector('small')?.textContent?.trim() ?? '';
    const left = /^\d+$/u.test(count) ? Number(count) : null;
    return [{ kind, element, left, enabled: !element.disabled && element.getAttribute('aria-disabled') !== 'true' && visible(element) }];
  });
}
export function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || element.closest('.hidden,[hidden]')) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}
export function readSnapshot(): Snapshot | null {
  const root = document.getElementById('picker');
  if (!visible(root)) return null;
  const title = text(root, '#pk-title');
  const key = normalizeName(title).replace(/[!¡！。:：\s]/gu, '');
  const levelTitles = ['levelup', '升級', '升级', 'subiudenível', 'subiudenivel', 'subadenível'];
  const chestTitles = ['cofredeltesoro', 'treasurechest', 'baúdotesouro', '寶箱'];
  const hasGain = activeMetadata(root, '#pk-gain') && !!text(root, '#pk-gain');
  const hasSockets = activeMetadata(root, '#lu-sockets');
  const kind = levelTitles.includes(key) && hasGain && hasSockets ? 'levelup'
    : chestTitles.includes(key) && !hasGain && hasSockets ? 'chest' : hasGain ? 'unknown' : 'other';
  const cards: Card[] = [...root.querySelectorAll<HTMLButtonElement>('#pk-cards .pk-card')].map(element => {
    const badge = text(element, '.pk-badge');
    const name = text(element, '.pk-name');
    const fresh = kind === 'levelup' && !!element.querySelector('.pk-ribbon');
    const rarity = readRarity(badge, fresh);
    // The live skill picker renders new skills with a ribbon; owned-skill
    // upgrades instead have a rarity badge. No session history is needed, so
    // manual picks and new runs are handled from the current card presentation.
    const skillState: Card['skillState'] = kind !== 'levelup' ? 'unknown'
      : fresh ? 'new' : rarity !== null && rarity >= 0 ? 'owned' : 'unknown';
    const actions: Card['actions'] = {};
    for (const action of readActions(element.closest('.pk-slot')?.querySelector('.pk-acts') ?? null)) {
      if (action.kind === 'focus' || action.kind === 'banish') actions[action.kind] = action;
    }
    // The potion card has no badge. Its identity is localized; never guess its rarity.
    return { name, badge, rarity, skillState, details: [text(element, '.pk-sub'), text(element, '.pk-lines')].filter(Boolean).join(' · '),
      requiresConfirmation: !!element.closest('.pk-slot')?.querySelector('.pk-back'),
      confirmationText: element.closest('.pk-slot')?.querySelector('.pk-back')?.textContent?.trim() ?? '', element, actions };
  });
  const reroll = readActions(root.querySelector('#pk-bar')).find(a => a.kind === 'reroll') ?? null;
  const actionSignature = (a: GameAction | null | undefined) => a ? [a.kind, a.left, a.enabled] : null;
  return {
    root, kind, title, cards, reroll,
    signature: JSON.stringify([kind, title, text(root, '#pk-sub'), text(root, '#pk-gain'), actionSignature(reroll), cards.map(c => [c.name, c.badge, c.skillState, c.details, c.requiresConfirmation, c.confirmationText, actionSignature(c.actions.focus), actionSignature(c.actions.banish)])]),
    timer: visible(root.querySelector('#pk-timer')) ? text(root, '#pk-timer') : '',
    closing: root.classList.contains('closing') || !!root.querySelector('.pk-slot.chosen'),
    confirming: !!root.querySelector('.pk-slot.asking,.pk-slot.flip'),
  };
}
export function sameRound(a: Snapshot, b: Snapshot): boolean {
  return a.root === b.root && a.signature === b.signature && a.cards.length === b.cards.length && a.cards.every((c, i) => c.element === b.cards[i].element);
}
