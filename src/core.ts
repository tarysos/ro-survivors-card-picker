import type { Card, Decision, PerkPlan, PickKind, Settings, Snapshot } from './types';

export const STORAGE_KEY = 'roPickerSettings';
export const normalizeName = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
export const defaults = (): Settings => ({
  version: 4,
  profiles: [{ id: 'default', name: '我的優先清單', priorities: [], chestPriorities: [] }],
  activeProfileId: 'default', fallback: 'pause', delayMinMs: 500, delayMaxMs: 1500,
  chestFallback: 'pause', chestAutoReplace: true,
  autoFocusFirst: true, autoBanishLastTwo: true, autoReroll: true, chestAutoReroll: true,
});
export const priorityName = (name: string, kind: PickKind): string => kind === 'chest' ? name.normalize('NFKC').trim().replace(/\s+\+\d+$/u, '') : name.trim();
export function uniqueNames(values: unknown[]): string[] {
  const seen = new Set<string>();
  return values.filter((v): v is string => typeof v === 'string')
    .map(v => v.trim().slice(0, 120)).filter(v => {
      const key = normalizeName(v);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 200);
}
export function sanitizeSettings(raw: unknown): Settings {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Partial<Settings>;
  const ids = new Set<string>();
  const profiles = Array.isArray(data.profiles) ? data.profiles.slice(0, 20).flatMap(p => {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id)) return [];
    ids.add(p.id);
    return [{ id: p.id.slice(0, 100), name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 60) : '未命名清單',
      priorities: uniqueNames(Array.isArray(p.priorities) ? p.priorities : []),
      chestPriorities: uniqueNames((Array.isArray(p.chestPriorities) ? p.chestPriorities : []).filter((n): n is string => typeof n === 'string').map(n => priorityName(n, 'chest'))) }];
  }) : [];
  if (profiles.length) base.profiles = profiles;
  base.activeProfileId = base.profiles.some(p => p.id === data.activeProfileId) ? data.activeProfileId! : base.profiles[0].id;
  base.fallback = data.fallback === 'rarity' ? 'rarity' : 'pause';
  base.chestFallback = data.chestFallback === 'rarity' ? 'rarity' : 'pause';
  base.chestAutoReplace = data.chestAutoReplace !== false;
  base.autoFocusFirst = data.autoFocusFirst !== false;
  base.autoBanishLastTwo = data.autoBanishLastTwo !== false;
  base.autoReroll = data.autoReroll !== false;
  base.chestAutoReroll = data.chestAutoReroll !== false;
  const delay = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(500, Math.min(5000, value))) : fallback;
  const lower = delay(data.delayMinMs, 500), upper = delay(data.delayMaxMs, 1500);
  base.delayMinMs = Math.min(lower, upper);
  base.delayMaxMs = Math.max(lower, upper);
  return base;
}
export function decideSnapshot(snapshot: Pick<Snapshot, 'kind'> & { cards: Pick<Card, 'name' | 'rarity'>[] }, settings: Settings): Decision {
  const profile = settings.profiles.find(p => p.id === settings.activeProfileId)!;
  if (snapshot.kind === 'levelup') {
    const rules = skillRules(settings);
    const banned = new Set(rules.banished.map(normalizeName));
    const candidates = snapshot.cards.map((card, index) => ({ card, index })).filter(c => !banned.has(normalizeName(c.card.name)));
    if (!candidates.length) return { index: null, reason: '目前只有放逐對象，請重抽或手動選擇' };
    const result = decide(candidates.map(c => c.card), rules.targets, settings.fallback);
    return { ...result, index: result.index === null ? null : candidates[result.index].index };
  }
  if (snapshot.kind === 'chest') return decide(snapshot.cards.map(c => ({ ...c, name: priorityName(c.name, 'chest') })), profile.chestPriorities, settings.chestFallback);
  return { index: null, reason: '僅處理升級技能與寶箱道具選牌' };
}
export function skillRules(settings: Settings): { focus: string | null; banished: string[]; targets: string[] } {
  const names = settings.profiles.find(p => p.id === settings.activeProfileId)!.priorities;
  // With fewer than three names, the first priority would overlap the last two.
  const banished = settings.autoBanishLastTwo && names.length >= 3 ? names.slice(-2) : [];
  return { focus: settings.autoFocusFirst ? names[0] ?? null : null, banished, targets: banished.length ? names.slice(0, -2) : names };
}
export function planPerk(snapshot: Pick<Snapshot, 'kind' | 'cards' | 'reroll'>, settings: Settings): PerkPlan | null {
  if (!snapshot.cards.length || (snapshot.kind !== 'levelup' && snapshot.kind !== 'chest')) return null;
  const profile = settings.profiles.find(p => p.id === settings.activeProfileId)!;
  const rules = skillRules(settings);
  const usable = (action: Snapshot['reroll']) => !!action?.enabled && action.left !== null && action.left > 0;
  if (snapshot.kind === 'levelup') {
    const focusIndex = rules.focus ? snapshot.cards.findIndex(card => normalizeName(card.name) === normalizeName(rules.focus!) && usable(card.actions.focus ?? null)) : -1;
    if (focusIndex >= 0) return { kind: 'focus', cardIndex: focusIndex, action: snapshot.cards[focusIndex].actions.focus!, description: `專注「${snapshot.cards[focusIndex].name}」` };
    for (const name of [...rules.banished].reverse()) {
      const index = snapshot.cards.findIndex(card => normalizeName(card.name) === normalizeName(name) && usable(card.actions.banish ?? null));
      if (index >= 0) return { kind: 'banish', cardIndex: index, action: snapshot.cards[index].actions.banish!, description: `放逐「${snapshot.cards[index].name}」` };
    }
  }
  const targets = snapshot.kind === 'levelup' ? rules.targets : profile.chestPriorities;
  const rerollEnabled = snapshot.kind === 'levelup' ? settings.autoReroll : settings.chestAutoReroll;
  const matched = snapshot.cards.some(card => targets.some(name => normalizeName(name) === normalizeName(priorityName(card.name, snapshot.kind as PickKind))));
  if (rerollEnabled && targets.length > 0 && !matched && usable(snapshot.reroll)) return { kind: 'reroll', cardIndex: null, action: snapshot.reroll!, description: `全部重抽（剩餘 ${snapshot.reroll!.left} 次）` };
  return null;
}
export function decide(cards: Pick<Card, 'name' | 'rarity'>[], priorities: string[], fallback: Settings['fallback']): Decision {
  if (!cards.length) return { index: null, reason: '等待卡牌載入' };
  const order = new Map(priorities.map((name, index) => [normalizeName(name), index]));
  const matched = cards.map((card, index) => ({ index, rank: order.get(normalizeName(card.name)), rarity: card.rarity }))
    .filter((c): c is typeof c & { rank: number } => c.rank !== undefined);
  if (matched.length) {
    matched.sort((a, b) => a.rank - b.rank || (b.rarity ?? -1) - (a.rarity ?? -1) || a.index - b.index);
    const winner = matched[0];
    return { index: winner.index, reason: `優先清單第 ${winner.rank + 1} 順位；同順位依稀有度、再由左至右` };
  }
  if (fallback === 'rarity' && cards.every(c => c.rarity !== null)) {
    const index = cards.reduce((best, c, i) => c.rarity! > cards[best].rarity! ? i : best, 0);
    return { index, reason: '清單未命中，依備用規則選最高稀有度' };
  }
  return { index: null, reason: fallback === 'rarity' ? '清單未命中，且有未知稀有度，請手動選擇' : '沒有符合優先清單的卡牌，請手動選擇' };
}

// These labels are UI text, not persistent game IDs. Unknown labels stay unknown.
const rarityGroups = [
  ['common', 'común', 'comum', '普通', '一般'],
  ['uncommon', 'poco común', 'incomum', '優良', '罕見', '不常見'],
  ['rare', 'raro', 'rara', '稀有'],
  ['epic', 'épico', 'épica', '史詩'],
  ['legendary', 'legendario', 'legendaria', 'lendário', 'lendária', '傳說', '传奇', '傳奇'],
  ['mythic', 'mítico', 'mítica', '神話'],
];
export function readRarity(badge: string, fresh: boolean): number | null {
  if (fresh) return -1;
  const value = normalizeName(badge);
  const index = rarityGroups.findIndex(group => group.includes(value));
  return index >= 0 ? index : null;
}
export const minimumDelay = (count: number, requested: number): number => Math.max(requested, 380 + count * 120 + 220);
export const sampleDelay = (settings: Pick<Settings, 'delayMinMs' | 'delayMaxMs'>, random: () => number = Math.random): number =>
  settings.delayMinMs + Math.floor(random() * (settings.delayMaxMs - settings.delayMinMs + 1));
