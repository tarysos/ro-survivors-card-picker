import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideSnapshot, defaults, minimumDelay, normalizeName, planPerk, priorityName, readRarity, sampleDelay, sanitizeSettings, skillRules, uniqueNames } from '../src/core';
import type { Card, GameAction, PerkKind } from '../src/types';

const action = (kind: PerkKind, left: number | null = 2, enabled = true): GameAction => ({ kind, left, enabled, element: {} as HTMLButtonElement });
const perkCard = (name: string, skillState: Card['skillState'] = 'owned'): Card => ({ name, rarity: 0, skillState, badge: '普通', details: '', requiresConfirmation: false, confirmationText: '', element: {} as HTMLButtonElement, actions: { focus: action('focus'), banish: action('banish') } });

test('loop settings migrate without choosing a stage or persisting activation', () => {
  const previous = { version: 4, profiles: [{ id: 'p', name: 'P', priorities: ['A'], chestPriorities: ['B'] }], activeProfileId: 'p' };
  const migrated = sanitizeSettings(previous);
  assert.equal(migrated.version, 5); assert.equal(migrated.loopStageName, '');
  assert.deepEqual(migrated.profiles, previous.profiles);
  assert.equal(sanitizeSettings({ ...previous, loopStageName: '  斐揚森林  ', loopEnabled: true }).loopStageName, '斐揚森林');
  assert.equal('loopEnabled' in sanitizeSettings({ loopEnabled: true }), false);
  assert.equal(sanitizeSettings({ loopStageName: {} }).loopStageName, '');
  assert.equal(sanitizeSettings({ loopStageName: 'A'.repeat(200) }).loopStageName.length, 120);
});

test('skill rules protect the first priority and banish only upgrades of the last two', () => {
  const settings = defaults();
  for (const names of [[], ['A'], ['A', 'B']]) {
    settings.profiles[0].priorities = names;
    assert.deepEqual(skillRules(settings).banishAfterLearning, []);
  }
  settings.profiles[0].priorities = ['A', 'B', 'C', 'D'];
  assert.deepEqual(skillRules(settings), { focus: 'A', targets: ['A', 'B', 'C', 'D'], banishAfterLearning: ['C', 'D'] });
  assert.equal(decideSnapshot({ kind: 'levelup', cards: [perkCard('D'), perkCard('B')] }, settings).index, 1);
  settings.fallback = 'rarity';
  assert.equal(decideSnapshot({ kind: 'levelup', cards: [perkCard('D'), perkCard('C')] }, settings).index, null);
  settings.autoBanishLastTwo = false;
  assert.equal(decideSnapshot({ kind: 'levelup', cards: [perkCard('D')] }, settings).index, 0);
});

test('perks run focus, lowest-priority banish, then selection; disabled or spent actions are skipped', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A', 'B', 'C', 'D'];
  const cards = ['C', 'A', 'D'].map(name => perkCard(name));
  const snapshot = { kind: 'levelup' as const, cards, reroll: action('reroll') };
  assert.equal(planPerk(snapshot, settings)?.kind, 'focus');
  assert.equal(planPerk(snapshot, settings)?.cardIndex, 1);
  cards[1].actions.focus!.enabled = false;
  assert.equal(planPerk(snapshot, settings)?.cardIndex, 2);
  cards[2].actions.banish!.left = 0;
  assert.equal(planPerk(snapshot, settings)?.cardIndex, 0);
  cards[0].actions.banish!.left = null;
  assert.equal(planPerk(snapshot, settings), null);
  assert.equal(decideSnapshot(snapshot, settings).index, 1);
});

test('reroll needs a nonempty target list, no matching target and a known positive counter in both scopes', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A']; settings.profiles[0].chestPriorities = ['Elixir'];
  for (const kind of ['levelup', 'chest'] as const) {
    const snapshot = { kind, cards: [perkCard('Missing')], reroll: action('reroll') };
    assert.equal(planPerk(snapshot, settings)?.kind, 'reroll');
    snapshot.reroll.left = 0; assert.equal(planPerk(snapshot, settings), null);
    snapshot.reroll.left = null; assert.equal(planPerk(snapshot, settings), null);
    snapshot.reroll.left = 1; snapshot.reroll.enabled = false; assert.equal(planPerk(snapshot, settings), null);
    snapshot.reroll.enabled = true;
    const empty = defaults(); assert.equal(planPerk(snapshot, empty), null);
    snapshot.cards = []; assert.equal(planPerk(snapshot, settings), null);
  }
  assert.equal(planPerk({ kind: 'chest', cards: [perkCard('Elixir +3')], reroll: action('reroll') }, settings), null);
  assert.equal(planPerk({ kind: 'other', cards: [perkCard('Missing')], reroll: action('reroll') }, settings), null);
  settings.autoReroll = false;
  assert.equal(planPerk({ kind: 'levelup', cards: [perkCard('Missing')], reroll: action('reroll') }, settings), null);
  assert.equal(planPerk({ kind: 'chest', cards: [perkCard('Missing')], reroll: action('reroll') }, settings)?.kind, 'reroll');
});

test('new perk defaults migrate existing lists and preserve explicit disabled switches', () => {
  const migrated = sanitizeSettings({ version: 3, profiles: [{ id: 'p', name: 'P', priorities: ['A', 'B', 'C'], chestPriorities: ['Item'] }] });
  assert.equal(migrated.autoFocusFirst, true); assert.equal(migrated.autoBanishLastTwo, true);
  assert.equal(migrated.autoReroll, true); assert.equal(migrated.chestAutoReroll, true);
  const disabled = sanitizeSettings({ ...migrated, autoFocusFirst: false, autoBanishLastTwo: false, autoReroll: false, chestAutoReroll: false });
  assert.deepEqual(skillRules(disabled), { focus: null, banishAfterLearning: [], targets: ['A', 'B', 'C'] });
  assert.equal(disabled.autoReroll, false); assert.equal(disabled.chestAutoReroll, false);
  assert.deepEqual(disabled.profiles[0].chestPriorities, ['Item']);
});

test('priority outranks rarity; names match exactly after harmless whitespace/case normalization', () => {
  assert.equal(decide([{ name: 'Fire Bolt', rarity: 0 }, { name: 'Cold Bolt', rarity: 4 }], [' FIRE   BOLT ', 'Cold Bolt'], 'pause').index, 0);
  assert.equal(decide([{ name: 'Fire Bolt II', rarity: 4 }], ['Fire Bolt'], 'pause').index, null);
  assert.equal(normalizeName(' Ａ  B '), 'a b');
});

test('last two skills are picked at their original ranks before their upgrades can be banished', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A', 'B', 'C', 'D'];
  const snapshot = { kind: 'levelup' as const, cards: [perkCard('D', 'new'), perkCard('C', 'new')], reroll: action('reroll') };
  assert.equal(planPerk(snapshot, settings), null);
  assert.equal(decideSnapshot(snapshot, settings).index, 1);
  assert.match(decideSnapshot(snapshot, settings).reason, /第 3 順位/);
  snapshot.cards.unshift(perkCard('B'));
  assert.equal(decideSnapshot(snapshot, settings).index, 2); // New C precedes upgrading B.
  settings.preferNewSkills = false;
  assert.equal(decideSnapshot(snapshot, settings).index, 0);
  settings.preferNewSkills = true;
  snapshot.cards.shift(); snapshot.cards[1].skillState = 'owned';
  assert.equal(planPerk(snapshot, settings)?.kind, 'banish');
  assert.equal(planPerk(snapshot, settings)?.cardIndex, 1);
  assert.equal(decideSnapshot(snapshot, settings).index, 0);
  snapshot.cards[1].actions.banish!.left = 0;
  assert.equal(planPerk(snapshot, settings), null); // New D is a target; do not reroll it away.
  snapshot.cards[0].skillState = 'owned'; snapshot.cards[0].actions.banish!.left = 0;
  assert.equal(planPerk(snapshot, settings)?.kind, 'reroll');
  assert.equal(decideSnapshot(snapshot, settings).index, null);
});

test('unknown ownership never authorizes banishment or exclusion from the priority list', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A', 'C', 'D'];
  const snapshot = { kind: 'levelup' as const, cards: [perkCard('D', 'unknown')], reroll: action('reroll') };
  assert.equal(planPerk(snapshot, settings), null);
  assert.equal(decideSnapshot(snapshot, settings).index, 0);
});
test('ties use rarity then visual order; unknown rarity stays below a recognized one', () => {
  const cards = [{ name: 'A', rarity: null }, { name: 'A', rarity: 3 }, { name: 'A', rarity: 3 }];
  assert.equal(decide(cards, ['A'], 'pause').index, 1);
});
test('unmatched default is manual; rarity fallback requires every label to be recognized', () => {
  const cards = [{ name: 'A', rarity: 0 }, { name: 'B', rarity: 3 }];
  assert.equal(decide(cards, ['C'], 'pause').index, null);
  assert.equal(decide(cards, ['C'], 'rarity').index, 1);
  assert.equal(decide([...cards, { name: '???', rarity: null }], [], 'rarity').index, null);
  assert.equal(decide([], ['A'], 'rarity').index, null);
});
test('rarity labels include the four observed game languages', () => {
  for (const label of ['Uncommon', 'Poco común', 'Incomum', '優良']) assert.equal(readRarity(label, false), 1);
  for (const label of ['Legendary', 'Legendario', 'Lendário', '傳說']) assert.equal(readRarity(label, false), 4);
  assert.equal(readRarity('Unrecognized', false), null);
  assert.equal(readRarity('技能', true), -1);
});
test('invalid or partial settings are bounded and recover to an existing profile', () => {
  assert.deepEqual(sanitizeSettings(null), defaults());
  const result = sanitizeSettings({ profiles: [{ id: 'x', name: 'Test', priorities: ['A', ' a ', '', 32, 'B'] }], activeProfileId: 'missing', delayMs: -100, fallback: 'anything' });
  assert.equal(result.activeProfileId, 'x');
  assert.deepEqual(result.profiles[0].priorities, ['A', 'B']);
  assert.equal(result.delayMinMs, 500);
  assert.equal(result.delayMaxMs, 1500);
  assert.equal(result.fallback, 'pause');
  assert.equal(sanitizeSettings({ delayMinMs: Infinity }).delayMinMs, 500);
  assert.deepEqual(uniqueNames(['a', 'A', 'B']), ['a', 'B']);
});
test('minimum delay respects the observed game animation lock for any card count', () => {
  assert.equal(minimumDelay(3, 500), 960);
  assert.equal(minimumDelay(6, 500), 1320);
  assert.equal(minimumDelay(3, 2500), 2500);
});

test('v1 settings retain all skill profiles and gain separate empty chest lists', () => {
  const settings = sanitizeSettings({ version: 1, profiles: [{ id: 'mage', name: '法師', priorities: ['Fire Bolt', 'Heal'] }], activeProfileId: 'mage', fallback: 'rarity', delayMs: 2500 });
  assert.equal(settings.version, 5);
  assert.equal(settings.activeProfileId, 'mage');
  assert.deepEqual(settings.profiles[0].priorities, ['Fire Bolt', 'Heal']);
  assert.deepEqual(settings.profiles[0].chestPriorities, []);
  assert.equal(settings.fallback, 'rarity');
  assert.equal(settings.chestFallback, 'pause');
  assert.equal(settings.delayMinMs, 500);
  assert.equal(settings.delayMaxMs, 1500);
  assert.equal(settings.chestAutoReplace, true);
  assert.equal(sanitizeSettings({ ...settings, chestAutoReplace: false }).chestAutoReplace, false);
});

test('random delay includes 500 and 1500 ms while respecting animation readiness', () => {
  const settings = defaults();
  assert.equal(sampleDelay(settings, () => 0), 500);
  assert.equal(sampleDelay(settings, () => .5), 1000);
  assert.equal(sampleDelay(settings, () => 1 - Number.EPSILON), 1500);
  const samples = Array.from({ length: 100 }, (_, i) => sampleDelay(settings, () => i / 100));
  assert.ok(samples.every(ms => Number.isInteger(ms) && ms >= 500 && ms <= 1500));
  assert.ok(new Set(samples).size > 90);
  assert.equal(minimumDelay(3, sampleDelay(settings, () => 0)), 960);
  assert.equal(minimumDelay(3, sampleDelay(settings, () => 1 - Number.EPSILON)), 1500);
  assert.equal(sampleDelay({ delayMinMs: 1200, delayMaxMs: 1200 }), 1200);
});

test('delay range validation and migration retain card settings and normalize reversed bounds', () => {
  const legacy = sanitizeSettings({ version: 2, delayMs: 800, chestFallback: 'rarity', chestAutoReplace: false, profiles: [{ id: 'x', name: 'Test', priorities: ['A'], chestPriorities: ['B'] }] });
  assert.equal(legacy.delayMinMs, 500); assert.equal(legacy.delayMaxMs, 1500);
  assert.deepEqual(legacy.profiles[0].priorities, ['A']); assert.deepEqual(legacy.profiles[0].chestPriorities, ['B']);
  assert.equal(legacy.chestFallback, 'rarity'); assert.equal(legacy.chestAutoReplace, false);
  const reversed = sanitizeSettings({ delayMinMs: 1500, delayMaxMs: 500 });
  assert.equal(reversed.delayMinMs, 500); assert.equal(reversed.delayMaxMs, 1500);
  const bounded = sanitizeSettings({ delayMinMs: -10, delayMaxMs: 10000 });
  assert.equal(bounded.delayMinMs, 500); assert.equal(bounded.delayMaxMs, 5000);
});
test('chest matching ignores only trailing refinement and uses its own priority/fallback', () => {
  const settings = defaults();
  settings.profiles[0].priorities = ['B']; settings.profiles[0].chestPriorities = ['A'];
  const cards = [{ name: 'B', rarity: 4, skillState: 'unknown' as const }, { name: 'A +3', rarity: 0, skillState: 'unknown' as const }];
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 1);
  assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 0);
  assert.equal(priorityName('A +3', 'levelup'), 'A +3');
  assert.equal(priorityName('A ＋３', 'chest'), 'A');
  assert.equal(priorityName('Potion + Power', 'chest'), 'Potion + Power');
  assert.equal(priorityName('Potion+3', 'chest'), 'Potion+3');
  settings.profiles[0].chestPriorities = []; settings.fallback = 'rarity';
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, null);
  settings.chestFallback = 'rarity';
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 0);
  assert.deepEqual(sanitizeSettings({ profiles: [{ id: 'x', chestPriorities: ['A +1', 'A +3'] }] }).profiles[0].chestPriorities, ['A']);
});

test('chest quality outranks order while skills can opt out of the new-skills rule', () => {
  const settings = defaults();
  settings.preferNewSkills = false;
  settings.profiles[0].priorities = ['A', 'B']; settings.profiles[0].chestPriorities = ['A', 'B'];
  const cards = [
    { ...perkCard('Outside'), rarity: 5 },
    { ...perkCard('A'), rarity: 0 },
    { ...perkCard('B'), rarity: 4 },
  ];
  for (const fallback of ['pause', 'rarity'] as const) {
    settings.chestFallback = fallback;
    const chest = decideSnapshot({ kind: 'chest', cards }, settings);
    assert.equal(chest.index, 2);
    assert.match(chest.reason, /清單內品質優先/);
    assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 1);
  }
});

test('listed orange skills precede new skills, then normal priority resumes when none are new', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A', 'B', 'C']; settings.autoBanishLastTwo = false;
  const cards = [perkCard('A'), perkCard('B', 'new'), { ...perkCard('C'), rarity: 4 }];
  assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 2);
  cards[2].rarity = 3;
  assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 1);
  cards[1].skillState = 'owned';
  assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 0);
});

test('new-skill priority excludes unlisted orange and new cards, and keeps rank within each group', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A', 'B'];
  const cards = [{ ...perkCard('Outside'), rarity: 4 }, perkCard('Outside new', 'new'), perkCard('B', 'new'), perkCard('A', 'new')];
  for (const fallback of ['pause', 'rarity'] as const) {
    settings.fallback = fallback;
    assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 3);
    cards[2].skillState = cards[3].skillState = 'owned'; cards[2].rarity = cards[3].rarity = 4;
    assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 3);
  }
});

test('orange upgrades do not bypass acquisition-before-banish exclusions', () => {
  const settings = defaults(); settings.profiles[0].priorities = ['A', 'B', 'C', 'D'];
  const cards = [perkCard('A'), { ...perkCard('C'), rarity: 4 }, perkCard('D', 'new')];
  assert.equal(decideSnapshot({ kind: 'levelup', cards }, settings).index, 2);
  assert.equal(planPerk({ kind: 'levelup', cards, reroll: action('reroll') }, settings)?.kind, 'focus');
  cards[0].actions.focus!.enabled = false;
  assert.equal(planPerk({ kind: 'levelup', cards, reroll: action('reroll') }, settings)?.cardIndex, 1);
  cards[1].actions.banish!.left = 0;
  assert.equal(planPerk({ kind: 'levelup', cards, reroll: action('reroll') }, settings), null);
});

test('new skill and loot preferences default on, persist opt-out, and can restore original priority', () => {
  const settings = sanitizeSettings({ version: 4 });
  assert.equal(settings.preferNewSkills, true); assert.equal(settings.autoCollectLoot, true);
  const disabled = sanitizeSettings({ ...settings, preferNewSkills: false, autoCollectLoot: false });
  assert.equal(disabled.preferNewSkills, false); assert.equal(disabled.autoCollectLoot, false);
  disabled.profiles[0].priorities = ['A', 'B'];
  assert.equal(decideSnapshot({ kind: 'levelup', cards: [perkCard('A'), { ...perkCard('B'), rarity: 4 }] }, disabled).index, 0);
});

test('equal chest quality uses list order then visual order and ignores refinement levels', () => {
  const settings = defaults(); settings.profiles[0].chestPriorities = ['A', 'B'];
  const cards = ['B +9', 'A +1', 'A +8'].map(name => ({ ...perkCard(name), rarity: 3 }));
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 1);
  settings.profiles[0].chestPriorities.reverse();
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 0);
  cards[2].rarity = 4;
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 2);
});

test('listed chest items with unknown quality rank below known quality and otherwise use list order', () => {
  const settings = defaults(); settings.profiles[0].chestPriorities = ['A', 'B'];
  const cards = [{ ...perkCard('B'), rarity: 0 as number | null }, { ...perkCard('A'), rarity: null }];
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 0);
  cards[0].rarity = null;
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, 1);
  settings.profiles[0].chestPriorities = ['Missing']; settings.chestFallback = 'rarity';
  assert.equal(decideSnapshot({ kind: 'chest', cards }, settings).index, null);
});
