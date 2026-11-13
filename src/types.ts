import type { RollCategory, RollChoice } from './roll-rules';

export type PickKind = 'levelup' | 'chest';
export type ItemRule = 'focus' | 'banish';
export type ItemRules = Record<ItemRule, string[]>;
export interface Profile {
  id: string; name: string; priorities: string[]; chestPriorities: string[];
  rules: Record<PickKind, ItemRules>;
}
export interface Settings {
  version: 7;
  profiles: Profile[];
  activeProfileId: string;
  fallback: 'pause' | 'rarity';
  chestFallback: 'pause' | 'rarity';
  chestAutoReplace: boolean;
  delayMinMs: number;
  delayMaxMs: number;
  autoReroll: boolean;
  chestAutoReroll: boolean;
  loopStageName: string;
  walkRadius: number;
  walkIntervalMs: number;
  preferNewSkills: boolean;
  autoCollectLoot: boolean;
  autoRollLoot: boolean;
  rollRules: Record<RollCategory, RollChoice>;
}
export type PerkKind = 'focus' | 'banish' | 'reroll';
export interface GameAction { kind: PerkKind; element: HTMLButtonElement; left: number | null; enabled: boolean }
export interface PerkPlan { kind: PerkKind; cardIndex: number | null; action: GameAction; description: string }
export interface Card {
  name: string;
  badge: string;
  rarity: number | null;
  ownership: 'new' | 'owned' | 'unknown';
  details: string;
  requiresConfirmation: boolean;
  confirmationText: string;
  element: HTMLButtonElement;
  actions: Partial<Record<'focus' | 'banish', GameAction>>;
}
export interface Snapshot {
  root: HTMLElement;
  kind: PickKind | 'other' | 'unknown';
  title: string;
  cards: Card[];
  signature: string;
  timer: string;
  closing: boolean;
  confirming: boolean;
  reroll: GameAction | null;
}
export interface Decision { index: number | null; reason: string }
export interface LogEntry { time: string; text: string }
export interface ViewState {
  enabled: boolean;
  status: string;
  recommendation: Decision;
  snapshot: Snapshot | null;
  logs: LogEntry[];
}
