import type { Card, Decision, ItemRules, PerkPlan, PickKind, Profile, Settings, Snapshot } from './types';
import { defaultRollRules, rollCategoryKeys } from './roll-rules';

export const STORAGE_KEY = 'roPickerSettings';
export const minWalkIntervalMs = 100;
export type WalkSetting = 'walkRadius' | 'walkIntervalMs';
export function validWalkSetting(key: WalkSetting, value: unknown): value is number {
  const minimum = key === 'walkRadius' ? 1 : minWalkIntervalMs;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
export const normalizeName = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
export const emptyProfile = (id: string, name: string): Profile => ({
  id, name, priorities: [], chestPriorities: [],
  rules: { levelup: { focus: [], banish: [], highQuality: [] }, chest: { focus: [], banish: [], highQuality: [] } },
});
export const defaults = (): Settings => ({
  version: 8,
  profiles: [emptyProfile('default', '我的優先清單')],
  activeProfileId: 'default', fallback: 'pause', delayMinMs: 500, delayMaxMs: 1500,
  chestFallback: 'pause', chestAutoReplace: true,
  autoReroll: true, chestAutoReroll: true,
  loopStageName: '',
  walkRadius: 3, walkIntervalMs: 2000,
  preferNewSkills: true, autoCollectLoot: true,
  autoRollLoot: true, rollRules: defaultRollRules(),
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
function sanitizeRules(raw: Partial<ItemRules> | undefined, names: string[]): ItemRules {
  const valid = (values: unknown) => {
    const marked = new Set(uniqueNames(Array.isArray(values) ? values : []).map(normalizeName));
    return names.filter(name => marked.has(normalizeName(name)));
  };
  const focus = valid(raw?.focus);
  return { focus, banish: valid(raw?.banish).filter(name => !focus.includes(name)), highQuality: valid(raw?.highQuality) };
}
export function sanitizeSettings(raw: unknown): Settings {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Partial<Settings> & { autoFocusFirst?: boolean; autoBanishLastTwo?: boolean };
  const ids = new Set<string>();
  const profiles = Array.isArray(data.profiles) ? data.profiles.slice(0, 20).flatMap(p => {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id)) return [];
    ids.add(p.id);
    const priorities = uniqueNames(Array.isArray(p.priorities) ? p.priorities : []);
    const chestPriorities = uniqueNames((Array.isArray(p.chestPriorities) ? p.chestPriorities : []).filter((n): n is string => typeof n === 'string').map(n => priorityName(n, 'chest')));
    const levelup = (data.version ?? 0) < 7 && !p.rules
      ? { focus: data.autoFocusFirst !== false ? priorities.slice(0, 1) : [],
          banish: data.autoBanishLastTwo !== false && priorities.length >= 3 ? priorities.slice(-2) : [], highQuality: [] }
      : sanitizeRules(p.rules?.levelup, priorities);
    return [{ id: p.id.slice(0, 100), name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 60) : '未命名清單',
      priorities, chestPriorities, rules: { levelup, chest: sanitizeRules(p.rules?.chest, chestPriorities) } }];
  }) : [];
  if (profiles.length) base.profiles = profiles;
  base.activeProfileId = base.profiles.some(p => p.id === data.activeProfileId) ? data.activeProfileId! : base.profiles[0].id;
  base.fallback = data.fallback === 'rarity' ? 'rarity' : 'pause';
  base.chestFallback = data.chestFallback === 'rarity' ? 'rarity' : 'pause';
  base.chestAutoReplace = data.chestAutoReplace !== false;
  base.autoReroll = data.autoReroll !== false;
  base.chestAutoReroll = data.chestAutoReroll !== false;
  base.loopStageName = typeof data.loopStageName === 'string' ? data.loopStageName.trim().slice(0, 120) : '';
  if (validWalkSetting('walkRadius', data.walkRadius)) base.walkRadius = data.walkRadius;
  if (validWalkSetting('walkIntervalMs', data.walkIntervalMs)) base.walkIntervalMs = data.walkIntervalMs;
  base.preferNewSkills = data.preferNewSkills !== false;
  base.autoCollectLoot = data.autoCollectLoot !== false;
  base.autoRollLoot = data.autoRollLoot !== false;
  for (const category of rollCategoryKeys) {
    const choice = data.rollRules?.[category];
    if (choice === 'need' || choice === 'greed') base.rollRules[category] = choice;
  }
  const delay = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(500, Math.min(5000, value))) : fallback;
  const lower = delay(data.delayMinMs, 500), upper = delay(data.delayMaxMs, 1500);
  base.delayMinMs = Math.min(lower, upper);
  base.delayMaxMs = Math.max(lower, upper);
  return base;
}
function isBanishUpgrade(card: Pick<Card, 'name' | 'ownership'>, names: string[], kind: PickKind): boolean {
  return card.ownership === 'owned' && names.some(name => normalizeName(name) === normalizeName(priorityName(card.name, kind)));
}
export function decideSnapshot(snapshot: Pick<Snapshot, 'kind'> & { cards: Pick<Card, 'name' | 'rarity' | 'ownership'>[] }, settings: Settings): Decision {
  const kind = snapshot.kind;
  if (kind !== 'levelup' && kind !== 'chest') return { index: null, reason: '僅處理升級技能與寶箱道具選牌' };
  const profile = settings.profiles.find(p => p.id === settings.activeProfileId)!;
  const names = kind === 'chest' ? profile.chestPriorities : profile.priorities;
  const rules = profile.rules[kind];
  const candidates = snapshot.cards.flatMap((card, index) => isBanishUpgrade(card, rules.banish, kind)
    ? [] : [{ index, name: priorityName(card.name, kind), rarity: card.rarity, ownership: card.ownership }]);
  if (!candidates.length && snapshot.cards.length) return { index: null, reason: '目前只有已取得的放逐對象，請重抽或手動選擇' };
  const marked = new Set(rules.highQuality.map(normalizeName));
  const epicOrBetter = candidates.filter(card => card.rarity !== null && card.rarity >= 3 && marked.has(normalizeName(card.name)));
  let pool = candidates;
  let order: 'rarity' | 'priority' = kind === 'chest' ? 'rarity' : 'priority';
  let reason = '';
  if (epicOrBetter.length) {
    pool = epicOrBetter;
    order = 'rarity';
    reason = '高品質優先（史詩以上）';
  } else if (kind === 'levelup' && settings.preferNewSkills) {
    const matched = candidates.filter(card => names.some(name => normalizeName(name) === normalizeName(card.name)));
    const orange = matched.filter(card => card.rarity === 4);
    const fresh = matched.filter(card => card.ownership === 'new');
    if (orange.length) { pool = orange; reason = '清單內橘色（傳說）技能優先'; }
    else if (fresh.length) { pool = fresh; reason = '優先補齊尚未取得的清單技能'; }
  }
  const result = decide(pool, names, kind === 'chest' ? settings.chestFallback : settings.fallback, order);
  return { index: result.index === null ? null : pool[result.index].index, reason: reason ? `${reason}；${result.reason}` : result.reason };
}
export function planPerk(snapshot: Pick<Snapshot, 'kind' | 'cards' | 'reroll'>, settings: Settings): PerkPlan | null {
  const kind = snapshot.kind;
  if (!snapshot.cards.length || (kind !== 'levelup' && kind !== 'chest')) return null;
  const profile = settings.profiles.find(p => p.id === settings.activeProfileId)!;
  const targets = kind === 'levelup' ? profile.priorities : profile.chestPriorities;
  const rules = profile.rules[kind];
  const usable = (action: Snapshot['reroll']) => !!action?.enabled && action.left !== null && action.left > 0;
  for (const perk of ['focus', 'banish'] as const) {
    const marked = targets.filter(name => rules[perk].includes(name));
    if (perk === 'banish') marked.reverse();
    for (const name of marked) {
      const index = snapshot.cards.findIndex(card => normalizeName(priorityName(card.name, kind)) === normalizeName(name)
        && (perk === 'focus' || card.ownership === 'owned') && usable(card.actions[perk] ?? null));
      if (index >= 0) {
        const card = snapshot.cards[index];
        return { kind: perk, cardIndex: index, action: card.actions[perk]!, description: `${perk === 'focus' ? '專注' : '放逐'}「${card.name}」` };
      }
    }
  }
  const rerollEnabled = snapshot.kind === 'levelup' ? settings.autoReroll : settings.chestAutoReroll;
  const matched = snapshot.cards.some(card => !isBanishUpgrade(card, rules.banish, kind)
    && targets.some(name => normalizeName(name) === normalizeName(priorityName(card.name, kind))));
  if (rerollEnabled && targets.length > 0 && !matched && usable(snapshot.reroll)) return { kind: 'reroll', cardIndex: null, action: snapshot.reroll!, description: `全部重抽（剩餘 ${snapshot.reroll!.left} 次）` };
  return null;
}
export function decide(cards: Pick<Card, 'name' | 'rarity'>[], priorities: string[], fallback: Settings['fallback'], orderBy: 'priority' | 'rarity' = 'priority'): Decision {
  if (!cards.length) return { index: null, reason: '等待卡牌載入' };
  const order = new Map(priorities.map((name, index) => [normalizeName(name), index]));
  const matched = cards.map((card, index) => ({ index, rank: order.get(normalizeName(card.name)), rarity: card.rarity }))
    .filter((c): c is typeof c & { rank: number } => c.rank !== undefined);
  if (matched.length) {
    matched.sort((a, b) => {
      const byPriority = a.rank - b.rank;
      const byRarity = (b.rarity ?? -1) - (a.rarity ?? -1);
      return (orderBy === 'rarity' ? byRarity || byPriority : byPriority || byRarity) || a.index - b.index;
    });
    const winner = matched[0];
    return { index: winner.index, reason: orderBy === 'rarity'
      ? `清單內品質優先；同品質依清單順位、再由左至右（第 ${winner.rank + 1} 順位）`
      : `優先清單第 ${winner.rank + 1} 順位；同順位依稀有度、再由左至右` };
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
  const value = normalizeName(badge);
  const index = rarityGroups.findIndex(group => group.includes(value));
  return index >= 0 ? index : fresh ? -1 : null;
}
export const minimumDelay = (count: number, requested: number): number => Math.max(requested, 380 + count * 120 + 220);
export const sampleDelay = (settings: Pick<Settings, 'delayMinMs' | 'delayMaxMs'>, random: () => number = Math.random): number =>
  settings.delayMinMs + Math.floor(random() * (settings.delayMaxMs - settings.delayMinMs + 1));
