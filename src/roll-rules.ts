export const rollCategories = {
  weapon: '武器', shield: '盾牌', armor: '鎧甲', garment: '披肩', shoes: '鞋子',
  headTop: '頭飾（上段）', headMid: '頭飾（中段）', headLow: '頭飾（下段）',
  accessory: '飾品', card: '卡片', egg: '寵物蛋', other: '其他',
} as const;
export type RollCategory = keyof typeof rollCategories;
export type RollChoice = 'need' | 'greed';
export const rollCategoryKeys = Object.keys(rollCategories) as RollCategory[];
export const rollChoiceLabels = { need: 'Need', greed: 'Greed' } as const;

export function defaultRollRules(): Record<RollCategory, RollChoice> {
  return {
    weapon: 'need', shield: 'greed', armor: 'greed', garment: 'greed', shoes: 'greed',
    headTop: 'greed', headMid: 'greed', headLow: 'greed', accessory: 'greed',
    card: 'greed', egg: 'greed', other: 'greed',
  };
}

// The roll dialog exposes the item ID in its artwork URL, but does not label equipment slots.
// Slot assignments from the game's public equipment catalog (2026-11-13).
const equipmentIds = {
  weapon: [
    1101, 1104, 1105, 1107, 1108, 1110, 1117, 1124, 1125, 1126, 1127, 1128, 1131, 1133, 1135, 1138,
    1152, 1163, 1189, 1201, 1202, 1207, 1208, 1210, 1214, 1216, 1217, 1219, 1220, 1222, 1228, 1234,
    1250, 1252, 1253, 1254, 1256, 1258, 1261, 1262, 1265, 1301, 1302, 1304, 1309, 1351, 1355, 1370,
    1377, 1402, 1405, 1407, 1408, 1413, 1460, 1466, 1477, 1501, 1502, 1504, 1505, 1511, 1513, 1517,
    1519, 1524, 1525, 1528, 1530, 1550, 1553, 1555, 1557, 1558, 1601, 1602, 1604, 1607, 1610, 1613,
    1648, 1701, 1702, 1704, 1708, 1711, 1718, 1722, 1734, 1801, 1803, 1805, 1806, 1809, 1812, 1813,
    1901, 1905, 1909, 1913, 1950, 1954, 1958, 1964, 13001, 13007, 13011, 13046, 13101, 13104, 13150,
    13151, 13156, 13160, 13301, 13303,
  ],
  shield: [2101, 2102, 2103, 2104, 2107, 2110, 2114, 2115, 2116, 2124],
  armor: [2301, 2302, 2303, 2304, 2305, 2306, 2307, 2308, 2311, 2314, 2316, 2320, 2321, 2324, 2329, 2330, 2333, 2335, 2336, 2337, 2353, 2355, 2357, 2367],
  garment: [2503, 2504, 2505, 2507, 2509, 2511, 2515],
  shoes: [2404, 2405, 2406, 2410, 2411, 2418, 2419, 2420, 2424],
  headTop: [2207, 2209, 2211, 2213, 2214, 2220, 2221, 2226, 2234, 2235, 2244, 2245, 2246, 2247, 2248, 2250, 2251, 2252, 2254, 2255, 2256, 2257, 2264, 2272, 2274, 2277, 2280, 2282, 2285, 2287, 2289, 2298, 2299, 5008, 5012, 5013, 5017, 5019, 5035, 5038, 5046],
  headMid: [2201, 2205, 2212, 2260, 2286, 2291, 2296],
  headLow: [2262, 2268, 2288, 2292, 2297],
  accessory: [2603, 2605, 2607, 2608, 2609, 2610, 2614, 2615, 2616, 2617, 2619, 2620, 2627, 2629, 2630, 2678, 2679, 22847],
};
const slots = new Map<number, RollCategory>();
for (const slot of Object.keys(equipmentIds) as (keyof typeof equipmentIds)[]) {
  for (const id of equipmentIds[slot]) slots.set(id, slot);
}

export function rollCategory(artwork: string, badge: string, baseStats: string[]): RollCategory {
  const path = artwork.split(/[?#]/, 1)[0];
  if (['卡片', 'card', 'carta'].includes(badge) || /(?:^|\/)cards\/\d+\.png$/i.test(path)) return 'card';
  if (['寵物蛋', 'pet egg', 'huevo de pet', 'ovo de mascote'].includes(badge)) return 'egg';
  const id = /(?:^|\/)items\/(\d+)(?:_art)?\.png$/i.exec(path)?.[1];
  const slot = id && slots.get(Number(id));
  if (slot) return slot;
  // New weapons also show a bold base ATK/MATK line. Ordinary bonus stats are not bold.
  return baseStats.some(stat => /^\+\d+ (?:ATK|MATK)$/.test(stat)) ? 'weapon' : 'other';
}
