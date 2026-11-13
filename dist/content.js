"use strict";
(() => {
  // src/core.ts
  var STORAGE_KEY = "roPickerSettings";
  var normalizeName = (value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  var defaults = () => ({
    version: 5,
    profiles: [{ id: "default", name: "\u6211\u7684\u512A\u5148\u6E05\u55AE", priorities: [], chestPriorities: [] }],
    activeProfileId: "default",
    fallback: "pause",
    delayMinMs: 500,
    delayMaxMs: 1500,
    chestFallback: "pause",
    chestAutoReplace: true,
    autoFocusFirst: true,
    autoBanishLastTwo: true,
    autoReroll: true,
    chestAutoReroll: true,
    loopStageName: "",
    preferNewSkills: true,
    autoCollectLoot: true
  });
  var priorityName = (name, kind) => kind === "chest" ? name.normalize("NFKC").trim().replace(/\s+\+\d+$/u, "") : name.trim();
  function uniqueNames(values) {
    const seen = /* @__PURE__ */ new Set();
    return values.filter((v) => typeof v === "string").map((v) => v.trim().slice(0, 120)).filter((v) => {
      const key = normalizeName(v);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 200);
  }
  function sanitizeSettings(raw) {
    const base = defaults();
    if (!raw || typeof raw !== "object") return base;
    const data = raw;
    const ids = /* @__PURE__ */ new Set();
    const profiles = Array.isArray(data.profiles) ? data.profiles.slice(0, 20).flatMap((p) => {
      if (!p || typeof p.id !== "string" || !p.id || ids.has(p.id)) return [];
      ids.add(p.id);
      return [{
        id: p.id.slice(0, 100),
        name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 60) : "\u672A\u547D\u540D\u6E05\u55AE",
        priorities: uniqueNames(Array.isArray(p.priorities) ? p.priorities : []),
        chestPriorities: uniqueNames((Array.isArray(p.chestPriorities) ? p.chestPriorities : []).filter((n) => typeof n === "string").map((n) => priorityName(n, "chest")))
      }];
    }) : [];
    if (profiles.length) base.profiles = profiles;
    base.activeProfileId = base.profiles.some((p) => p.id === data.activeProfileId) ? data.activeProfileId : base.profiles[0].id;
    base.fallback = data.fallback === "rarity" ? "rarity" : "pause";
    base.chestFallback = data.chestFallback === "rarity" ? "rarity" : "pause";
    base.chestAutoReplace = data.chestAutoReplace !== false;
    base.autoFocusFirst = data.autoFocusFirst !== false;
    base.autoBanishLastTwo = data.autoBanishLastTwo !== false;
    base.autoReroll = data.autoReroll !== false;
    base.chestAutoReroll = data.chestAutoReroll !== false;
    base.loopStageName = typeof data.loopStageName === "string" ? data.loopStageName.trim().slice(0, 120) : "";
    base.preferNewSkills = data.preferNewSkills !== false;
    base.autoCollectLoot = data.autoCollectLoot !== false;
    const delay = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(500, Math.min(5e3, value))) : fallback;
    const lower = delay(data.delayMinMs, 500), upper = delay(data.delayMaxMs, 1500);
    base.delayMinMs = Math.min(lower, upper);
    base.delayMaxMs = Math.max(lower, upper);
    return base;
  }
  function isBanishUpgrade(card, names) {
    return card.skillState === "owned" && names.some((name) => normalizeName(name) === normalizeName(card.name));
  }
  function decideSnapshot(snapshot, settings) {
    const profile = settings.profiles.find((p) => p.id === settings.activeProfileId);
    if (snapshot.kind === "levelup") {
      const rules = skillRules(settings);
      const candidates = snapshot.cards.map((card, index) => ({ card, index })).filter((c) => !isBanishUpgrade(c.card, rules.banishAfterLearning));
      if (!candidates.length) return { index: null, reason: "\u76EE\u524D\u53EA\u6709\u5DF2\u53D6\u5F97\u6280\u80FD\u7684\u653E\u9010\u5C0D\u8C61\uFF0C\u8ACB\u91CD\u62BD\u6216\u624B\u52D5\u9078\u64C7" };
      if (settings.preferNewSkills) {
        const matched = candidates.filter(({ card }) => rules.targets.some((name) => normalizeName(name) === normalizeName(card.name)));
        const orange = matched.filter(({ card }) => card.rarity === 4);
        const fresh = matched.filter(({ card }) => card.skillState === "new");
        const preferred = orange.length ? orange : fresh;
        if (preferred.length) {
          const result2 = decide(preferred.map(({ card }) => card), rules.targets, "pause");
          return { index: preferred[result2.index].index, reason: `${orange.length ? "\u6E05\u55AE\u5167\u6A58\u8272\uFF08\u50B3\u8AAA\uFF09\u6280\u80FD\u512A\u5148" : "\u512A\u5148\u88DC\u9F4A\u5C1A\u672A\u53D6\u5F97\u7684\u6E05\u55AE\u6280\u80FD"}\uFF1B${result2.reason}` };
        }
      }
      const result = decide(candidates.map((c) => c.card), rules.targets, settings.fallback);
      return { ...result, index: result.index === null ? null : candidates[result.index].index };
    }
    if (snapshot.kind === "chest") return decide(snapshot.cards.map((c) => ({ ...c, name: priorityName(c.name, "chest") })), profile.chestPriorities, settings.chestFallback, "rarity");
    return { index: null, reason: "\u50C5\u8655\u7406\u5347\u7D1A\u6280\u80FD\u8207\u5BF6\u7BB1\u9053\u5177\u9078\u724C" };
  }
  function skillRules(settings) {
    const names = settings.profiles.find((p) => p.id === settings.activeProfileId).priorities;
    const banishAfterLearning = settings.autoBanishLastTwo && names.length >= 3 ? names.slice(-2) : [];
    return { focus: settings.autoFocusFirst ? names[0] ?? null : null, banishAfterLearning, targets: names };
  }
  function planPerk(snapshot, settings) {
    if (!snapshot.cards.length || snapshot.kind !== "levelup" && snapshot.kind !== "chest") return null;
    const profile = settings.profiles.find((p) => p.id === settings.activeProfileId);
    const rules = skillRules(settings);
    const usable = (action) => !!action?.enabled && action.left !== null && action.left > 0;
    if (snapshot.kind === "levelup") {
      const focusIndex = rules.focus ? snapshot.cards.findIndex((card) => normalizeName(card.name) === normalizeName(rules.focus) && usable(card.actions.focus ?? null)) : -1;
      if (focusIndex >= 0) return { kind: "focus", cardIndex: focusIndex, action: snapshot.cards[focusIndex].actions.focus, description: `\u5C08\u6CE8\u300C${snapshot.cards[focusIndex].name}\u300D` };
      for (const name of [...rules.banishAfterLearning].reverse()) {
        const index = snapshot.cards.findIndex((card) => isBanishUpgrade(card, [name]) && usable(card.actions.banish ?? null));
        if (index >= 0) return { kind: "banish", cardIndex: index, action: snapshot.cards[index].actions.banish, description: `\u653E\u9010\u300C${snapshot.cards[index].name}\u300D` };
      }
    }
    const targets = snapshot.kind === "levelup" ? rules.targets : profile.chestPriorities;
    const rerollEnabled = snapshot.kind === "levelup" ? settings.autoReroll : settings.chestAutoReroll;
    const matched = snapshot.cards.some((card) => (snapshot.kind !== "levelup" || !isBanishUpgrade(card, rules.banishAfterLearning)) && targets.some((name) => normalizeName(name) === normalizeName(priorityName(card.name, snapshot.kind))));
    if (rerollEnabled && targets.length > 0 && !matched && usable(snapshot.reroll)) return { kind: "reroll", cardIndex: null, action: snapshot.reroll, description: `\u5168\u90E8\u91CD\u62BD\uFF08\u5269\u9918 ${snapshot.reroll.left} \u6B21\uFF09` };
    return null;
  }
  function decide(cards, priorities, fallback, orderBy = "priority") {
    if (!cards.length) return { index: null, reason: "\u7B49\u5F85\u5361\u724C\u8F09\u5165" };
    const order = new Map(priorities.map((name, index) => [normalizeName(name), index]));
    const matched = cards.map((card, index) => ({ index, rank: order.get(normalizeName(card.name)), rarity: card.rarity })).filter((c) => c.rank !== void 0);
    if (matched.length) {
      matched.sort((a, b) => {
        const byPriority = a.rank - b.rank;
        const byRarity = (b.rarity ?? -1) - (a.rarity ?? -1);
        return (orderBy === "rarity" ? byRarity || byPriority : byPriority || byRarity) || a.index - b.index;
      });
      const winner = matched[0];
      return { index: winner.index, reason: orderBy === "rarity" ? `\u6E05\u55AE\u5167\u54C1\u8CEA\u512A\u5148\uFF1B\u540C\u54C1\u8CEA\u4F9D\u6E05\u55AE\u9806\u4F4D\u3001\u518D\u7531\u5DE6\u81F3\u53F3\uFF08\u7B2C ${winner.rank + 1} \u9806\u4F4D\uFF09` : `\u512A\u5148\u6E05\u55AE\u7B2C ${winner.rank + 1} \u9806\u4F4D\uFF1B\u540C\u9806\u4F4D\u4F9D\u7A00\u6709\u5EA6\u3001\u518D\u7531\u5DE6\u81F3\u53F3` };
    }
    if (fallback === "rarity" && cards.every((c) => c.rarity !== null)) {
      const index = cards.reduce((best, c, i) => c.rarity > cards[best].rarity ? i : best, 0);
      return { index, reason: "\u6E05\u55AE\u672A\u547D\u4E2D\uFF0C\u4F9D\u5099\u7528\u898F\u5247\u9078\u6700\u9AD8\u7A00\u6709\u5EA6" };
    }
    return { index: null, reason: fallback === "rarity" ? "\u6E05\u55AE\u672A\u547D\u4E2D\uFF0C\u4E14\u6709\u672A\u77E5\u7A00\u6709\u5EA6\uFF0C\u8ACB\u624B\u52D5\u9078\u64C7" : "\u6C92\u6709\u7B26\u5408\u512A\u5148\u6E05\u55AE\u7684\u5361\u724C\uFF0C\u8ACB\u624B\u52D5\u9078\u64C7" };
  }
  var rarityGroups = [
    ["common", "com\xFAn", "comum", "\u666E\u901A", "\u4E00\u822C"],
    ["uncommon", "poco com\xFAn", "incomum", "\u512A\u826F", "\u7F55\u898B", "\u4E0D\u5E38\u898B"],
    ["rare", "raro", "rara", "\u7A00\u6709"],
    ["epic", "\xE9pico", "\xE9pica", "\u53F2\u8A69"],
    ["legendary", "legendario", "legendaria", "lend\xE1rio", "lend\xE1ria", "\u50B3\u8AAA", "\u4F20\u5947", "\u50B3\u5947"],
    ["mythic", "m\xEDtico", "m\xEDtica", "\u795E\u8A71"]
  ];
  function readRarity(badge, fresh) {
    if (fresh) return -1;
    const value = normalizeName(badge);
    const index = rarityGroups.findIndex((group) => group.includes(value));
    return index >= 0 ? index : null;
  }
  var minimumDelay = (count, requested) => Math.max(requested, 380 + count * 120 + 220);
  var sampleDelay = (settings, random = Math.random) => settings.delayMinMs + Math.floor(random() * (settings.delayMaxMs - settings.delayMinMs + 1));

  // src/adapter.ts
  var text = (root, selector) => root.querySelector(selector)?.textContent?.trim() ?? "";
  function activeMetadata(root, selector) {
    const element = root.querySelector(selector);
    return !!element && !element.classList.contains("hidden") && !element.hasAttribute("hidden");
  }
  function readActions(root) {
    if (!root) return [];
    return [...root.querySelectorAll(".pk-act")].flatMap((element) => {
      const label = normalizeName([...element.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join(""));
      const kind = ["focus", "\u5C08\u6CE8"].includes(label) ? "focus" : ["banish", "\u653E\u9010"].includes(label) ? "banish" : ["reroll deck", "\u91CD\u62BD\u5168\u90E8"].includes(label) ? "reroll" : null;
      if (!kind) return [];
      const count = element.querySelector("small")?.textContent?.trim() ?? "";
      const left = /^\d+$/u.test(count) ? Number(count) : null;
      return [{ kind, element, left, enabled: !element.disabled && element.getAttribute("aria-disabled") !== "true" && visible(element) }];
    });
  }
  function visible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected || element.closest(".hidden,[hidden]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  function readSnapshot() {
    const root = document.getElementById("picker");
    if (!visible(root)) return null;
    const title = text(root, "#pk-title");
    const key = normalizeName(title).replace(/[!¡！。:：\s]/gu, "");
    const levelTitles = ["levelup", "\u5347\u7D1A", "\u5347\u7EA7", "subiuden\xEDvel", "subiudenivel", "subaden\xEDvel"];
    const chestTitles = ["cofredeltesoro", "treasurechest", "ba\xFAdotesouro", "\u5BF6\u7BB1"];
    const hasGain = activeMetadata(root, "#pk-gain") && !!text(root, "#pk-gain");
    const hasSockets = activeMetadata(root, "#lu-sockets");
    const kind = levelTitles.includes(key) && hasGain && hasSockets ? "levelup" : chestTitles.includes(key) && !hasGain && hasSockets ? "chest" : hasGain ? "unknown" : "other";
    const cards = [...root.querySelectorAll("#pk-cards .pk-card")].map((element) => {
      const badge = text(element, ".pk-badge");
      const name = text(element, ".pk-name");
      const fresh = kind === "levelup" && !!element.querySelector(".pk-ribbon");
      const rarity = readRarity(badge, fresh);
      const skillState = kind !== "levelup" ? "unknown" : fresh ? "new" : rarity !== null && rarity >= 0 ? "owned" : "unknown";
      const actions = {};
      for (const action of readActions(element.closest(".pk-slot")?.querySelector(".pk-acts") ?? null)) {
        if (action.kind === "focus" || action.kind === "banish") actions[action.kind] = action;
      }
      return {
        name,
        badge,
        rarity,
        skillState,
        details: [text(element, ".pk-sub"), text(element, ".pk-lines")].filter(Boolean).join(" \xB7 "),
        requiresConfirmation: !!element.closest(".pk-slot")?.querySelector(".pk-back"),
        confirmationText: element.closest(".pk-slot")?.querySelector(".pk-back")?.textContent?.trim() ?? "",
        element,
        actions
      };
    });
    const reroll = readActions(root.querySelector("#pk-bar")).find((a) => a.kind === "reroll") ?? null;
    const actionSignature = (a) => a ? [a.kind, a.left, a.enabled] : null;
    return {
      root,
      kind,
      title,
      cards,
      reroll,
      signature: JSON.stringify([kind, title, text(root, "#pk-sub"), text(root, "#pk-gain"), actionSignature(reroll), cards.map((c) => [c.name, c.badge, c.skillState, c.details, c.requiresConfirmation, c.confirmationText, actionSignature(c.actions.focus), actionSignature(c.actions.banish)])]),
      timer: visible(root.querySelector("#pk-timer")) ? text(root, "#pk-timer") : "",
      closing: root.classList.contains("closing") || !!root.querySelector(".pk-slot.chosen"),
      confirming: !!root.querySelector(".pk-slot.asking,.pk-slot.flip")
    };
  }
  function sameRound(a, b) {
    return a.root === b.root && a.signature === b.signature && a.cards.length === b.cards.length && a.cards.every((c, i) => c.element === b.cards[i].element);
  }

  // src/loot.ts
  var LootCollector = class {
    constructor(log, fail) {
      this.log = log;
      this.fail = fail;
    }
    log;
    fail;
    current = null;
    attempt = null;
    defer() {
      if (this.current && !this.current.handled) this.current.readyAt = performance.now() + this.current.delay;
    }
    manual() {
      if (this.current) this.current.handled = true;
    }
    tick(settings, enabled) {
      const root = document.getElementById("drop-reveal");
      const shown = visible(root);
      const button = shown ? root.querySelector("button.dr-get") : null;
      const name = shown ? root.querySelector(".dr-name")?.textContent?.trim() ?? "" : "";
      const badge = shown ? root.querySelector(".dr-q")?.textContent?.trim() ?? "" : "";
      const signature = JSON.stringify([name, badge, button?.textContent]);
      if (this.attempt) {
        if (!shown || button !== this.attempt.loot.button || signature !== this.attempt.loot.signature) {
          this.log(`\u5DF2\u9EDE\u64CA\u53D6\u5F97\u300C${this.attempt.loot.name}\u300D`);
          this.attempt = null;
        } else if (performance.now() - this.attempt.at > 1500) {
          this.attempt = null;
          this.fail("\u904A\u6232\u672A\u78BA\u8A8D\u88DD\u5099\u53D6\u5F97\uFF0C\u5DF2\u66AB\u505C\u3002\u8ACB\u624B\u52D5\u6AA2\u67E5\u63D0\u793A\u3002");
        }
      }
      if (!shown) {
        this.current = null;
        return null;
      }
      const isEquipment = readRarity(badge.split("\xB7")[0].trim(), false) !== null;
      const supported = button && visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" && !root.classList.contains("roll") && !root.querySelector(".dr-roll, [data-c], .dr-result") && ["\u53D6\u5F97", "get", "coger", "pegar"].includes(normalizeName(button.textContent ?? "")) && isEquipment && !!name;
      if (!supported) {
        this.current = null;
        return "\u6389\u843D\u63D0\u793A\u4FDD\u7559\u624B\u52D5\u64CD\u4F5C";
      }
      if (this.current?.button !== button || this.current.signature !== signature) {
        const delay = Math.max(750, sampleDelay(settings));
        this.current = { button, name, signature, delay, readyAt: performance.now() + delay, handled: false };
      }
      if (this.attempt) return "\u7B49\u5F85\u904A\u6232\u78BA\u8A8D\u88DD\u5099\u53D6\u5F97";
      if (this.current.handled) return "\u88DD\u5099\u63D0\u793A\u5DF2\u8655\u7406 \xB7 \u7B49\u5F85\u95DC\u9589";
      if (!enabled || !settings.autoCollectLoot) return "\u88DD\u5099\u53D6\u5F97\u63D0\u793A \xB7 \u81EA\u52D5\u53D6\u5F97\u5C1A\u672A\u555F\u7528";
      if (document.visibilityState !== "visible") {
        this.defer();
        return "\u5206\u9801\u5728\u80CC\u666F \xB7 \u8FD4\u56DE\u5F8C\u53D6\u5F97\u88DD\u5099";
      }
      if (performance.now() >= this.current.readyAt) {
        this.current.handled = true;
        this.attempt = { loot: this.current, at: performance.now() };
        button.click();
        return "\u7B49\u5F85\u904A\u6232\u78BA\u8A8D\u88DD\u5099\u53D6\u5F97";
      }
      return `\u5373\u5C07\u53D6\u5F97\u300C${name}\u300D`;
    }
  };

  // src/engine.ts
  var PickerEngine = class {
    settings;
    round = null;
    readyAt = 0;
    sampledDelayMs = 0;
    handled = false;
    pending;
    queued = false;
    observer;
    observed = null;
    lootObserver;
    observedLoot = null;
    loot = new LootCollector((text2) => this.log(text2), (text2) => this.pauseWithError(text2));
    attempt = null;
    error = "";
    perkAttempt = null;
    listeners = /* @__PURE__ */ new Set();
    state = { enabled: false, status: "\u9810\u89BD\u6A21\u5F0F \xB7 \u81EA\u52D5\u9078\u724C\u5C1A\u672A\u555F\u7528", recommendation: { index: null, reason: "" }, snapshot: null, logs: [] };
    constructor(settings) {
      this.settings = settings;
      this.observer = new MutationObserver(() => this.queue());
      this.lootObserver = new MutationObserver(() => this.queue());
      setInterval(() => this.queue(), 500);
      document.addEventListener("visibilitychange", () => {
        this.loot.defer();
        this.queue();
      });
      document.addEventListener("click", (event) => {
        const target = event.target;
        if (event.isTrusted && target instanceof Element && target.closest("#drop-reveal")) this.loot.manual();
        if (event.isTrusted && target instanceof Element && target.closest("#picker .pk-card, #picker .pk-act, #picker [data-yes], #picker [data-no]")) this.manualIntervention();
      }, true);
      window.addEventListener("keydown", (event) => {
        if (event.isTrusted && visible(document.getElementById("drop-reveal")) && !event.composedPath().some((node) => node instanceof HTMLElement && node.id === "ro-picker-assistant") && ["Enter", " ", "Escape"].includes(event.key)) {
          this.loot.manual();
          return;
        }
        if (event.isTrusted && !event.composedPath().some((node) => node instanceof HTMLElement && node.id === "ro-picker-assistant") && this.round && /^(?:[1-9]|Enter| )$/.test(event.key)) this.manualIntervention();
      }, true);
      this.queue();
    }
    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.state);
      return () => this.listeners.delete(listener);
    }
    emit() {
      this.listeners.forEach((listener) => listener(this.state));
    }
    log(text2) {
      this.state.logs.unshift({ time: (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-TW", { hour12: false }), text: text2 });
      this.state.logs.length = Math.min(this.state.logs.length, 30);
    }
    cancel() {
      clearTimeout(this.pending);
      this.pending = void 0;
    }
    queue() {
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        this.tick();
      });
    }
    setEnabled(enabled) {
      this.loot.defer();
      this.cancel();
      this.error = "";
      this.state.enabled = enabled;
      if (!enabled) this.abandonConfirmation();
      if (enabled && this.round) this.readyAt = performance.now() + minimumDelay(this.round.cards.length, this.sampledDelayMs);
      this.log(enabled ? "\u5DF2\u555F\u7528\u81EA\u52D5\u9078\u724C\uFF08\u50C5\u6B64\u5206\u9801\uFF09" : "\u5DF2\u66AB\u505C\u81EA\u52D5\u9078\u724C");
      this.queue();
    }
    updateSettings(settings) {
      if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
      this.loot.defer();
      const delayChanged = settings.delayMinMs !== this.settings.delayMinMs || settings.delayMaxMs !== this.settings.delayMaxMs;
      this.abandonConfirmation();
      this.cancel();
      this.settings = settings;
      if (this.round) {
        if (delayChanged) this.sampledDelayMs = sampleDelay(settings);
        this.readyAt = performance.now() + minimumDelay(this.round.cards.length, this.sampledDelayMs);
      }
      this.queue();
    }
    pauseWithError(message) {
      this.abandonConfirmation();
      this.cancel();
      this.state.enabled = false;
      this.error = message;
      this.log(message);
      this.queue();
    }
    clearLogs() {
      this.state.logs = [];
      this.emit();
    }
    manualIntervention() {
      this.perkAttempt = null;
      this.abandonConfirmation();
      this.cancel();
      this.handled = true;
      this.state.status = "\u672C\u8F2A\u5DF2\u4EA4\u7531\u4F60\u624B\u52D5\u64CD\u4F5C";
      this.emit();
    }
    abandonConfirmation() {
      if (this.attempt?.phase === "opening") {
        this.attempt = null;
        this.cancel();
      }
    }
    canReplace(snapshot) {
      return snapshot.kind === "chest" && this.settings.chestAutoReplace;
    }
    confirmReplacement(next) {
      const attempt = this.attempt;
      const card = attempt.snapshot.cards[attempt.index];
      if (!this.state.enabled || document.visibilityState !== "visible" || !next || !sameRound(next, attempt.snapshot) || !this.canReplace(next) || next.closing || decideSnapshot(next, this.settings).index !== attempt.index) {
        this.abandonConfirmation();
        this.queue();
        return;
      }
      const slot = card.element.closest(".pk-slot");
      const asking = !!slot?.classList.contains("asking");
      if (attempt.sawConfirmation && !asking) {
        this.abandonConfirmation();
        this.queue();
        return;
      }
      attempt.sawConfirmation ||= asking;
      const elapsed = performance.now() - attempt.at;
      const button = slot?.querySelector(".pk-back [data-yes]");
      if (asking && elapsed >= 450 && button && !button.disabled && visible(button)) {
        attempt.phase = "submitted";
        attempt.at = performance.now();
        this.cancel();
        button.click();
        this.queue();
        setTimeout(() => this.queue(), 550);
      } else if (elapsed >= 2e3) {
        this.pauseWithError("\u5BF6\u7BB1\u66FF\u63DB\u78BA\u8A8D\u672A\u5C31\u7DD2\uFF0C\u5DF2\u66AB\u505C\u3002\u8ACB\u624B\u52D5\u9078\u64C7\u3002");
      } else {
        this.state.status = `\u5373\u5C07\u78BA\u8A8D\u66FF\u63DB\u300C${card.name}\u300D`;
        this.cancel();
        this.pending = setTimeout(() => this.queue(), 100);
        this.emit();
      }
    }
    tick() {
      const root = document.getElementById("picker");
      if (root !== this.observed) {
        this.observer.disconnect();
        this.observed = root;
        if (root) this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled", "hidden", "style"] });
      }
      const next = readSnapshot();
      this.state.snapshot = next;
      const lootRoot = document.getElementById("drop-reveal");
      if (lootRoot !== this.observedLoot) {
        this.lootObserver.disconnect();
        this.observedLoot = lootRoot;
        if (lootRoot) this.lootObserver.observe(lootRoot, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled", "hidden", "style"] });
      }
      const lootStatus = this.loot.tick(this.settings, this.state.enabled);
      if (lootStatus) {
        this.cancel();
        this.state.status = this.error || lootStatus;
        this.state.recommendation = { index: null, reason: "\u7B49\u5F85\u88DD\u5099\u63D0\u793A\u95DC\u9589" };
        this.emit();
        return;
      }
      if (this.perkAttempt) {
        const { snapshot, plan, at } = this.perkAttempt;
        const currentActions = next ? [next.reroll, ...next.cards.flatMap((c) => Object.values(c.actions))] : [];
        const spent = next?.root === snapshot.root && next.kind === snapshot.kind && currentActions.some((a) => a?.kind === plan.kind && a.left !== null && a.left < plan.action.left);
        const removed = plan.kind === "banish" && next?.root === snapshot.root && next.kind === snapshot.kind && !sameRound(snapshot, next) && !next.cards.some((c) => normalizeName(c.name) === normalizeName(snapshot.cards[plan.cardIndex].name));
        if (spent || removed) {
          this.log(`\u5DF2${plan.description}`);
          this.perkAttempt = null;
        } else if (performance.now() - at >= 800) {
          this.perkAttempt = null;
          this.pauseWithError("\u904A\u6232\u672A\u78BA\u8A8D\u5C08\u6CE8\uFF0F\u653E\u9010\uFF0F\u91CD\u62BD\u64CD\u4F5C\uFF0C\u5DF2\u66AB\u505C\uFF0C\u8ACB\u6AA2\u67E5\u756B\u9762\u3002");
          return;
        } else {
          this.state.status = `\u7B49\u5F85\u904A\u6232\u78BA\u8A8D\uFF1A${plan.description}`;
          this.emit();
          return;
        }
      }
      if (this.attempt && !this.attempt.acknowledged) {
        const attempt = this.attempt;
        const card = attempt.snapshot.cards[attempt.index];
        if (card.element.closest(".pk-slot")?.classList.contains("chosen")) {
          attempt.acknowledged = true;
          this.log(`\u5DF2\u9078\u64C7\u300C${card.name}\u300D\uFF5C${attempt.snapshot.kind === "chest" ? "\u5BF6\u7BB1" : "\u6280\u80FD"}\uFF5C${attempt.reason}`);
        } else if (attempt.phase === "opening") {
          this.confirmReplacement(next);
          return;
        } else if (performance.now() - attempt.at >= 500) {
          this.attempt = null;
          this.pauseWithError("\u904A\u6232\u672A\u78BA\u8A8D\u9078\u724C\uFF0C\u5DF2\u66AB\u505C\u3002\u8ACB\u624B\u52D5\u9078\u64C7\u4E26\u6AA2\u67E5\u756B\u9762\u3002");
          return;
        } else {
          this.state.status = "\u7B49\u5F85\u904A\u6232\u78BA\u8A8D\u9078\u724C";
          this.emit();
          return;
        }
      }
      if (!next) {
        this.cancel();
        this.round = null;
        this.handled = false;
        if (this.attempt?.acknowledged) this.attempt = null;
        this.state.recommendation = { index: null, reason: "" };
        this.state.status = this.error || (this.state.enabled ? "\u76E3\u770B\u4E2D \xB7 \u7B49\u5F85\u5347\u7D1A\u6216\u5BF6\u7BB1\u9078\u724C" : "\u9810\u89BD\u6A21\u5F0F \xB7 \u81EA\u52D5\u9078\u724C\u5C1A\u672A\u555F\u7528");
        this.emit();
        return;
      }
      if (!this.round || !sameRound(this.round, next)) {
        this.cancel();
        this.round = next;
        this.handled = false;
        if (this.attempt?.acknowledged) this.attempt = null;
        this.sampledDelayMs = sampleDelay(this.settings);
        this.readyAt = performance.now() + minimumDelay(next.cards.length, this.sampledDelayMs);
      }
      this.state.recommendation = decideSnapshot(next, this.settings);
      const decision = this.state.recommendation;
      const perk = planPerk(next, this.settings);
      if (this.error) this.state.status = this.error;
      else if (next.kind !== "levelup" && next.kind !== "chest") this.state.status = `\u4FDD\u7559\u624B\u52D5\u64CD\u4F5C \xB7 ${next.title || "\u672A\u77E5\u9078\u724C\u756B\u9762"}`;
      else if (next.closing) this.state.status = "\u9078\u724C\u5B8C\u6210 \xB7 \u7B49\u5F85\u4E0B\u4E00\u8F2A";
      else if (next.confirming || !perk && decision.index !== null && next.cards[decision.index].requiresConfirmation && !this.canReplace(next)) this.state.status = "\u9700\u8981\u66FF\u63DB\u78BA\u8A8D \xB7 \u8ACB\u624B\u52D5\u9078\u64C7";
      else if (this.handled) this.state.status = "\u672C\u8F2A\u5DF2\u8655\u7406 \xB7 \u7B49\u5F85\u4E0B\u4E00\u8F2A";
      else if (document.visibilityState !== "visible") this.state.status = "\u5206\u9801\u5728\u80CC\u666F \xB7 \u8FD4\u56DE\u5F8C\u7E7C\u7E8C";
      else if (perk) {
        this.state.status = `${this.state.enabled ? "\u5373\u5C07" : "\u9810\u89BD\uFF1A"}${perk.description}`;
        this.cancel();
        if (this.state.enabled) this.pending = setTimeout(() => this.performPerk(next, perk), Math.max(0, this.readyAt - performance.now()));
        this.emit();
        return;
      } else if (decision.index === null) this.state.status = decision.reason;
      else if (!this.state.enabled) this.state.status = `\u63A8\u85A6\u300C${next.cards[decision.index].name}\u300D\xB7 \u9810\u89BD\u6A21\u5F0F`;
      else {
        const wait = Math.max(0, this.readyAt - performance.now());
        this.state.status = `\u5373\u5C07\u9078\u64C7\u300C${next.cards[decision.index].name}\u300D`;
        this.cancel();
        const expected = next;
        this.pending = setTimeout(() => this.pick(expected, decision.index), wait);
        this.emit();
        return;
      }
      this.cancel();
      this.emit();
    }
    pick(expected, index) {
      this.pending = void 0;
      const current = readSnapshot();
      if (!this.state.enabled || document.visibilityState !== "visible" || visible(document.getElementById("drop-reveal")) || this.handled || !current || !sameRound(expected, current) || current.kind !== "levelup" && current.kind !== "chest" || current.closing || current.confirming) {
        this.queue();
        return;
      }
      const decision = decideSnapshot(current, this.settings);
      if (planPerk(current, this.settings)) {
        this.queue();
        return;
      }
      const card = current.cards[index];
      if (decision.index !== index || !card || card.requiresConfirmation && !this.canReplace(current) || card.element.disabled || !visible(card.element)) {
        this.pauseWithError("\u5361\u724C\u76EE\u524D\u7121\u6CD5\u64CD\u4F5C\uFF0C\u5DF2\u66AB\u505C\u3002");
        return;
      }
      this.handled = true;
      this.attempt = {
        snapshot: current,
        index,
        at: performance.now(),
        acknowledged: false,
        reason: decision.reason,
        phase: card.requiresConfirmation ? "opening" : "submitted",
        sawConfirmation: false
      };
      card.element.click();
      this.queue();
      setTimeout(() => this.queue(), 550);
    }
    performPerk(expected, plan) {
      this.pending = void 0;
      const current = readSnapshot();
      if (!this.state.enabled || this.handled || document.visibilityState !== "visible" || visible(document.getElementById("drop-reveal")) || !current || !sameRound(expected, current) || current.closing || current.confirming) {
        this.queue();
        return;
      }
      const latest = planPerk(current, this.settings);
      if (!latest || latest.kind !== plan.kind || latest.cardIndex !== plan.cardIndex || latest.action.element !== plan.action.element || latest.action.element.disabled || !visible(latest.action.element)) {
        this.queue();
        return;
      }
      this.handled = true;
      this.perkAttempt = { snapshot: current, plan: latest, at: performance.now() };
      latest.action.element.click();
      this.queue();
      setTimeout(() => this.queue(), 850);
    }
  };

  // src/panel.css
  var panel_default = ':host { all: initial; color-scheme: dark; font-family: "Segoe UI", "Microsoft JhengHei", sans-serif; font-size: 13px; color: #e9edf5; }\n* { box-sizing: border-box; }\nbutton, input, select { font: inherit; }\nbutton { cursor: pointer; }\nbutton:disabled { cursor: default; opacity: .4; }\nbutton:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #6bd5b7; outline-offset: 2px; }\n.launcher { position: fixed; right: 18px; top: 18px; padding: 11px 15px; color: #d9fff3; background: #182b2b; border: 1px solid #4c7b71; border-radius: 12px; box-shadow: 0 8px 30px #0006; }\n.launcher.active::before { content: "\u25CF "; color: #6bdfb5; }\n.panel { position: fixed; right: 18px; top: 18px; width: 350px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 36px); overflow: auto; background: #151c27; border: 1px solid #334153; border-radius: 16px; box-shadow: 0 16px 64px #0009; }\n[hidden] { display: none !important; }\nheader { display: flex; align-items: center; padding: 17px 18px 13px; gap: 10px; border-bottom: 1px solid #2b3544; }\n.logo { color: #77dbbb; border: 1px solid #527a72; border-radius: 8px; padding: 6px; font-size: 18px; }\nheader strong { display: block; font-size: 16px; letter-spacing: .5px; }\nheader small { color: #99a7bc; font-size: 11px; }\nheader .icon { margin-left: auto; }\nbutton { color: #dce5f4; background: #253043; border: 1px solid #3b4a60; border-radius: 7px; padding: 7px 10px; }\nbutton:hover:not(:disabled) { background: #334158; }\n.icon { min-width: 28px; padding: 5px 7px; }\n.primary { color: #10271f; background: #77dbbb; border-color: #77dbbb; font-weight: 700; }\n.primary:hover:not(:disabled) { background: #a2ebd3; }\n.pause { background: #693c30; border-color: #9a5d46; color: #ffe0cc; }\n.pause:hover:not(:disabled) { background: #80503f; color: #ffe0cc; }\n.body { padding: 14px 16px 16px; }\n.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }\n.mode { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #91a3bc; }\n.mode.on { color: #77dbbb; }\n.status { margin: 10px 0 5px; line-height: 1.7; font-size: 12px; color: #d6e4f3; min-height: 21px; }\n.note, .empty { color: #96a5ba; font-size: 11px; line-height: 1.7; }\n.timer { color: #ffc280; font-size: 11px; line-height: 1.7; }\n.section { margin-top: 16px; padding-top: 14px; border-top: 1px solid #2b3544; }\n.label { display: block; color: #c2cfdf; font-size: 12px; font-weight: 600; margin-bottom: 8px; }\n.row { display: flex; align-items: center; gap: 6px; }\ninput, select { min-width: 0; width: 100%; color: #e8edf6; background: #0f1520; border: 1px solid #344154; border-radius: 7px; padding: 8px; }\ninput::placeholder { color: #7f90a8; }\n.row input, .row select { flex: 1; }\n.row button { flex-shrink: 0; }\n.loop-actions { margin-top: 10px; flex-wrap: wrap; }\n.loop-actions button { flex: 1; font-size: 11px; }\n.kind-tabs { display: flex; gap: 6px; margin-top: 12px; }\n.kind-tabs button { flex: 1; font-size: 12px; }\n.kind-tabs button[aria-pressed="true"] { color: #9fe8d1; border-color: #538c7b; background: #213d35; }\ndetails .checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }\ndetails .checkbox-row input { width: 15px; height: 15px; margin: 0; accent-color: #77dbbb; }\n.delay-range { align-items: flex-end; }\n.delay-range label { flex: 1; min-width: 0; font-size: 11px; color: #96a5ba; margin-top: 5px; }\n.delay-range > span { padding-bottom: 8px; color: #96a5ba; }\nol { margin: 10px 0; padding: 0; list-style: none; max-height: 220px; overflow: auto; }\n.priority { display: flex; align-items: center; gap: 6px; padding: 7px 0; border-bottom: 1px solid #252f3e; }\n.rank { color: #77dbbb; width: 20px; font-variant-numeric: tabular-nums; text-align: center; flex-shrink: 0; }\n.rule-tag { color: #9fe8d1; background: #213d35; font-size: 10px; padding: 2px 4px; border-radius: 4px; flex-shrink: 0; }\n.rule-tag.banish { color: #ffc2a5; background: #4b302a; }\n.name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; }\n.priority .icon { font-size: 11px; min-width: 25px; padding: 4px; }\n.priority[draggable="true"] { cursor: grab; }\n.priority.drag-over { background: #284139; }\n.current { display: grid; gap: 7px; }\n.card { padding: 9px 10px; border: 1px solid #334153; border-radius: 8px; background: #111824; }\n.card.recommended { border-color: #68c7aa; background: #1a302c; }\n.card .row { align-items: flex-start; }\n.card strong { flex: 1; font-size: 12px; overflow-wrap: anywhere; }\n.card small { display: block; color: #9eb0c5; font-size: 10px; margin-top: 4px; }\n.card button { font-size: 11px; padding: 3px 7px; }\n.reason { color: #8ad6bf; font-size: 10px; margin-top: 5px; line-height: 1.6; }\ndetails summary { cursor: pointer; font-size: 12px; color: #c2cfdf; }\ndetails label { display: block; margin-top: 12px; }\ndetails select, details input { margin-top: 5px; }\n.log { margin: 9px 0; max-height: 150px; overflow: auto; }\n.log p { margin: 0 0 8px; color: #bcc9db; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }\n.log time { color: #768ba6; margin-right: 6px; }\n.message { color: #ffcb8a; font-size: 11px; min-height: 0; line-height: 1.6; margin-top: 6px; }\n.profile-editor { padding: 10px 0 0; }\n.profile-editor .row + .row { margin-top: 8px; }\nfooter { font-size: 10px; color: #7e91ab; margin-top: 14px; line-height: 1.7; }\n@media (max-width: 600px) { .panel { right: 12px; top: 12px; max-height: calc(100dvh - 24px); } }\n';

  // src/run-adapter.ts
  var byId = (id) => document.getElementById(id);
  var labels = (values, text2) => values.some((value) => normalizeName(value) === normalizeName(text2));
  function readRunScreen() {
    const overlays = [...document.querySelectorAll(".overlay")].filter(visible);
    const blocking = overlays.find((el) => !["loading", "gameover", "stages", "npc-dialog", "picker", "drop-reveal"].includes(el.id));
    if (blocking) return { kind: "blocked", root: blocking, label: blocking.querySelector(".ro-title")?.textContent?.trim() || "\u5176\u4ED6\u904A\u6232\u8996\u7A97" };
    if (visible(byId("drop-reveal"))) return { kind: "loot", root: byId("drop-reveal"), label: "\u6389\u843D\u63D0\u793A" };
    for (const [id, kind] of [["loading", "loading"], ["npc-dialog", "dialog"], ["gameover", "settlement"], ["stages", "stages"]]) {
      const root = byId(id);
      if (visible(root)) return { kind, root, label: root.querySelector(".ro-title")?.textContent?.trim() ?? "" };
    }
    if (document.body.classList.contains("in-lobby") && visible(byId("lobby-ui"))) return { kind: "lobby", root: byId("lobby-ui"), label: "\u57CE\u93AE" };
    if (!document.body.classList.contains("in-lobby") && visible(byId("hud"))) return { kind: "battle", root: byId("hud"), label: "\u6230\u9B25" };
    return { kind: "unknown", root: null, label: "" };
  }
  function stageChoices() {
    if (!visible(byId("stages"))) return [];
    return [...document.querySelectorAll("#stg-list button.stg-card")].map((element) => ({
      element,
      name: element.querySelector(".stg-card-info b")?.textContent?.trim() ?? "",
      available: visible(element) && !element.disabled && !element.matches(".locked, .soon") && element.matches(".open, .cleared"),
      selected: element.classList.contains("sel")
    })).filter((stage) => stage.name);
  }
  function selectedStageName() {
    return visible(byId("stages")) ? document.querySelector("#stg-detail .stg-banner-text b")?.textContent?.trim() ?? "" : "";
  }
  function currentStageName() {
    if (readRunScreen().kind === "stages") return selectedStageName();
    if (readRunScreen().kind === "battle") return byId("minimap-name")?.textContent?.trim() ?? "";
    return "";
  }
  function captainPrompt() {
    const button = byId("lobby-prompt");
    if (!(button instanceof HTMLButtonElement) || !visible(button) || button.disabled) return null;
    const clone = button.cloneNode(true);
    clone.querySelectorAll("kbd").forEach((el) => el.remove());
    return labels(["\u8207\u968A\u9577\u4EA4\u8AC7", "Talk to the captain", "Hablar con el capit\xE1n", "Falar com o capit\xE3o"], clone.textContent ?? "") ? button : null;
  }
  function departureButton() {
    return usableButton("stg-go");
  }
  function usableButton(id) {
    const element = byId(id);
    return element instanceof HTMLButtonElement && visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" ? element : null;
  }
  function difficultyConfirmation() {
    if (!visible(byId("npc-dialog")) || !labels(["\u96E3\u5EA6", "Difficulty", "Dificultad", "Dificuldade"], byId("npc-name")?.textContent ?? "")) return null;
    const controls = [...document.querySelectorAll('#npc-text .diff input[type="range"][data-key]')];
    const keys = controls.map((el) => el.dataset.key).sort().join(",");
    if (keys !== "count,damage,events,hp,speed" || controls.some((el) => !Number.isFinite(el.valueAsNumber)) || document.querySelector("#npc-text [data-pick]")) return null;
    const buttons = [...document.querySelectorAll("#npc-options button.primary")].filter((el) => visible(el) && !el.disabled);
    if (buttons.length !== 1) return null;
    return labels(["\u524D\u5F80\u91CE\u5916", "Go to the field", "Ir al campo", "Ir para o campo"], buttons[0].textContent ?? "") ? buttons[0] : null;
  }

  // src/panel.ts
  var Panel = class {
    constructor(settings, actions) {
      this.actions = actions;
      this.settings = settings;
      const host = document.createElement("div");
      host.id = "ro-picker-assistant";
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
      this.shadow = host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `
      <style>${panel_default}
.panel,.launcher { pointer-events:auto; }</style>
      <button class="launcher" id="launcher" aria-label="\u958B\u555F RO \u9078\u724C\u52A9\u624B">\u2667 \u9078\u724C\u52A9\u624B</button>
      <section class="panel" id="panel" aria-label="RO \u9078\u724C\u52A9\u624B" hidden>
        <header><span class="logo" aria-hidden="true">\u2667</span><div><strong>RO \u9078\u724C\u52A9\u624B</strong><small>\u4F60\u7684\u6E05\u55AE\uFF0C\u4F60\u7684\u6253\u6CD5 \xB7 v0.4.0</small></div><button class="icon" id="collapse" aria-label="\u6536\u5408\u9762\u677F">\u2212</button></header>
        <div class="body">
          <div class="toolbar"><span class="mode" id="mode">PREVIEW / \u9810\u89BD</span><button id="toggle" class="primary">\u555F\u7528\u81EA\u52D5\u9078\u724C</button></div>
          <p class="status" id="status" role="status" aria-live="polite"></p>
          <div class="timer" id="timer"></div>
          <div class="note">\u81EA\u52D5\u8655\u7406\u5347\u7D1A\u6280\u80FD\u3001\u5BF6\u7BB1\u9078\u724C\u8207\u88DD\u5099\u53D6\u5F97\u63D0\u793A\u3002\u91CD\u65B0\u6574\u7406\u5F8C\u56DE\u5230\u9810\u89BD\u6A21\u5F0F\u3002</div>
          <details class="section" id="loop-settings"><summary>\u5FAA\u74B0\u5237\u95DC \xB7 \u9060\u5F81\u968A\u9577</summary>
            <label class="label" for="loop-stage">\u5FAA\u74B0\u95DC\u5361</label>
            <input id="loop-stage" list="loop-stages" maxlength="120" placeholder="\u8F38\u5165\u904A\u6232\u4E2D\u7684\u5B8C\u6574\u95DC\u5361\u540D\u7A31" autocomplete="off">
            <datalist id="loop-stages"></datalist>
            <div class="row loop-actions"><button id="loop-capture">\u4F7F\u7528\u76EE\u524D\u95DC\u5361</button><button id="loop-toggle" class="primary">\u555F\u7528\u5FAA\u74B0\u5237\u95DC</button></div>
            <p class="status" id="loop-status" role="status" aria-live="polite">\u5FAA\u74B0\u5C1A\u672A\u555F\u7528</p>
            <p class="note" id="loop-count">\u672C\u5206\u9801\u5DF2\u7D50\u7B97 0 \u5834</p>
            <p class="note">\u53EF\u5728\u95DC\u5361\u9078\u55AE\u6216\u6230\u9B25\u4E2D\u8B80\u53D6\u540D\u7A31\uFF1B\u958B\u555F\u968A\u9577\u9078\u55AE\u5F8C\u4E5F\u53EF\u5F9E\u8F38\u5165\u6846\u9078\u95DC\u3002\u6CBF\u7528\u904A\u6232\u76EE\u524D\u96E3\u5EA6\uFF0C\u52DD\u5229\u6216\u6B7B\u4EA1\u7D50\u7B97\u5F8C\u7B49 2.5 \u79D2\u56DE\u57CE\uFF0C\u518D\u6B21\u51FA\u767C\u3002\u555F\u7528\u5FAA\u74B0\u6703\u4E00\u4F75\u555F\u7528\u81EA\u52D5\u9078\u724C\u3002</p>
            <p class="note">\u56DE\u57CE\u51FA\u751F\u9EDE\u53EF\u76F4\u63A5\u8207\u968A\u9577\u4EA4\u8AC7\uFF1B\u82E5\u5DF2\u8D70\u9060\uFF0C\u8ACB\u5148\u9760\u8FD1\u968A\u9577\u3002\u652F\u63F4\u55AE\u4EBA\u4E00\u822C\u95DC\u5361\uFF1B\u5287\u60C5\u3001\u7D44\u968A\u8207\u5176\u4ED6\u5C0D\u8A71\u6703\u66AB\u505C\u3002\u5206\u9801\u9700\u7559\u5728\u524D\u666F\u3002</p>
            <details><summary>\u6700\u8FD1\u5FAA\u74B0\u7D00\u9304</summary><div id="loop-logs" class="log"></div></details>
          </details>
          <div class="section">
            <label class="label" for="profiles">\u4F7F\u7528\u4E2D\u7684\u512A\u5148\u6E05\u55AE</label>
            <div class="row"><select id="profiles" aria-label="\u9078\u64C7\u512A\u5148\u6E05\u55AE"></select><button class="icon" id="manage" aria-label="\u7BA1\u7406\u6E05\u55AE">\u7BA1\u7406</button></div>
            <div class="profile-editor" id="profile-editor" hidden>
              <input id="profile-name" placeholder="\u6E05\u55AE\u540D\u7A31\uFF0C\u4F8B\u5982\uFF1A\u6CD5\u5E2B\u7DF4\u7B49" maxlength="60" aria-label="\u6E05\u55AE\u540D\u7A31">
              <div class="row"><button id="new-profile">\u65B0\u589E\u6E05\u55AE</button><button id="rename-profile">\u91CD\u65B0\u547D\u540D</button><button id="delete-profile">\u522A\u9664\u6B64\u6E05\u55AE</button></div>
            </div>
            <div class="kind-tabs" role="group" aria-label="\u6E05\u55AE\u985E\u578B"><button id="kind-levelup" aria-pressed="true">\u5347\u7D1A\u6280\u80FD</button><button id="kind-chest" aria-pressed="false">\u5BF6\u7BB1\u9053\u5177</button></div>
            <ol id="priorities" aria-label="\u5361\u724C\u512A\u5148\u9806\u5E8F"></ol>
            <div class="empty" id="empty-priorities">\u9084\u6C92\u6709\u512A\u5148\u5361\u724C\u3002\u8F38\u5165\u904A\u6232\u986F\u793A\u7684\u540D\u7A31\uFF0C\u6216\u5F9E\u4E0B\u65B9\u76EE\u524D\u9078\u724C\u52A0\u5165\u3002</div>
            <form id="add-form" class="row"><input id="card-name" placeholder="\u8F38\u5165\u5B8C\u6574\u5361\u724C\u540D\u7A31" maxlength="120" aria-label="\u5361\u724C\u540D\u7A31" autocomplete="off"><button type="submit">\u52A0\u5165</button></form>
            <div class="note" id="priority-help" style="margin-top:6px"></div>
            <div class="message" id="message" role="status"></div>
          </div>
          <div class="section"><span class="label">\u76EE\u524D\u9078\u724C</span><div id="current" class="current"><div class="empty">\u5347\u7D1A\u6216\u5BF6\u7BB1\u9078\u724C\u51FA\u73FE\u5F8C\uFF0C\u6703\u5728\u9019\u88E1\u986F\u793A\u3002</div></div></div>
          <details class="section" id="advanced"><summary>\u9078\u724C\u8A2D\u5B9A</summary>
            <label class="checkbox-row"><input id="prefer-new-skills" type="checkbox">\u5148\u62FF\u9F4A\u6E05\u55AE\u6280\u80FD\uFF08\u6A58\u8272\u512A\u5148\uFF09</label>
            <p class="note">\u6E05\u55AE\u5167\u6A58\u8272\uFF08\u50B3\u8AAA\uFF09\u724C\u512A\u5148\uFF1B\u6C92\u6709\u6A58\u8272\u6642\u5148\u53D6\u5F97\u65B0\u6280\u80FD\uFF0C\u518D\u7167\u9806\u4F4D\u5347\u7D1A\u3002\u540C\u985E\u5019\u9078\u4ECD\u4F9D\u9806\u4F4D\u3002\u4E0D\u70BA\u4E86\u88DC\u9F4A\u6280\u80FD\u9078\u5165\u6E05\u55AE\u5916\u7684\u724C\uFF1B\u5DF2\u53D6\u5F97\u7684\u653E\u9010\u5C0D\u8C61\u4ECD\u6392\u9664\u3002</p>
            <label class="checkbox-row"><input id="auto-focus" type="checkbox">\u6280\u80FD\u7B2C\u4E00\u9806\u4F4D\u81EA\u52D5\u5C08\u6CE8</label>
            <label class="checkbox-row"><input id="auto-banish" type="checkbox">\u6280\u80FD\u6700\u5F8C\u5169\u9806\u4F4D\uFF1A\u5148\u53D6\u5F97\uFF0C\u518D\u653E\u9010</label>
            <p class="note">\u6280\u80FD\u6E05\u55AE\u81F3\u5C11 3 \u9805\u624D\u555F\u7528\u3002\u6700\u5F8C\u5169\u9806\u4F4D\u5C1A\u672A\u53D6\u5F97\u6642\u4ECD\u4F9D\u9806\u4F4D\u9078\u5165\uFF1B\u5DF2\u53D6\u5F97\u5F8C\uFF0C\u518D\u51FA\u73FE\u5347\u7D1A\u724C\u624D\u653E\u9010\u3001\u4E0D\u7E7C\u7E8C\u5347\u7D1A\u3002\u5C08\u6CE8\u3001\u653E\u9010\u6709\u5269\u9918\u6B21\u6578\u624D\u6703\u57F7\u884C\u3002</p>
            <label class="checkbox-row"><input id="auto-reroll" type="checkbox">\u6280\u80FD\u6C92\u6709\u76EE\u6A19\u724C\u6642\u5168\u90E8\u91CD\u62BD</label>
            <label class="checkbox-row"><input id="chest-auto-reroll" type="checkbox">\u5BF6\u7BB1\u6C92\u6709\u76EE\u6A19\u724C\u6642\u5168\u90E8\u91CD\u62BD</label>
            <p class="note">\u6709\u8A2D\u5B9A\u76EE\u6A19\u6E05\u55AE\u624D\u6703\u91CD\u62BD\u3002\u91CD\u62BD\u6B21\u6578\u7528\u5B8C\u5F8C\uFF0C\u4F9D\u4E0B\u65B9\u672A\u547D\u4E2D\u898F\u5247\u8655\u7406\u3002</p>
            <label class="note" for="fallback">\u6280\u80FD\u6E05\u55AE\u6C92\u6709\u547D\u4E2D\u6642</label>
            <select id="fallback"><option value="pause">\u4EA4\u7531\u6211\u624B\u52D5\u9078\u64C7</option><option value="rarity">\u9078\u6700\u9AD8\u7A00\u6709\u5EA6\uFF08\u5FC5\u9808\u5168\u90E8\u8FA8\u8B58\u6210\u529F\uFF09</option></select>
            <label class="note" for="chest-fallback">\u5BF6\u7BB1\u6E05\u55AE\u6C92\u6709\u547D\u4E2D\u6642</label>
            <select id="chest-fallback"><option value="pause">\u4EA4\u7531\u6211\u624B\u52D5\u9078\u64C7</option><option value="rarity">\u9078\u6700\u9AD8\u7A00\u6709\u5EA6\uFF08\u5FC5\u9808\u5168\u90E8\u8FA8\u8B58\u6210\u529F\uFF09</option></select>
            <label class="checkbox-row"><input id="chest-replace" type="checkbox">\u5BF6\u7BB1\u81EA\u52D5\u78BA\u8A8D\u66FF\u63DB</label>
            <p class="note">\u6E05\u55AE\u5167\u5019\u9078\u724C\u5148\u6BD4\u54C1\u8CEA\uFF0C\u540C\u54C1\u8CEA\u518D\u6BD4\u9806\u4F4D\uFF1B\u52FE\u9078\u5F8C\u6703\u78BA\u8A8D\u66FF\u63DB\u8A72\u6B04\u4F4D\u539F\u6709\u9053\u5177\u3002\u95DC\u9589\u5F8C\uFF0C\u9700\u66FF\u63DB\u7684\u724C\u4EA4\u7531\u4F60\u8655\u7406\u3002</p>
            <label class="checkbox-row"><input id="auto-collect-loot" type="checkbox">\u64BF\u5230\u88DD\u5099\u5F8C\u81EA\u52D5\u9EDE\u300C\u53D6\u5F97\u300D</label>
            <p class="note">\u555F\u7528\u81EA\u52D5\u9078\u724C\u5F8C\u751F\u6548\u3002\u7B49\u52D5\u756B\u89E3\u9396\u518D\u95DC\u9589\u88DD\u5099\u63D0\u793A\uFF1B\u4E0D\u64CD\u4F5C\u7D44\u968A\u64F2\u9AB0\u6216\u5176\u4ED6\u734E\u52F5\u9078\u64C7\u3002</p>
            <div class="note" style="margin-top:12px">\u6BCF\u8F2A\u96A8\u6A5F\u9078\u724C\u5EF6\u9072\uFF08\u6BEB\u79D2\uFF09</div>
            <div class="row delay-range"><label for="delay-min">\u6700\u77ED<input id="delay-min" type="number" min="500" max="5000" step="100"></label><span>\uFF5E</span><label for="delay-max">\u6700\u9577<input id="delay-max" type="number" min="500" max="5000" step="100"></label></div>
            <p class="note">\u9810\u8A2D 500\uFF5E1500 \u6BEB\u79D2\uFF0C\u6BCF\u8F2A\u91CD\u65B0\u62BD\u53D6\u4E00\u6B21\u3002\u82E5\u904A\u6232\u52D5\u756B\u5C1A\u672A\u7D50\u675F\uFF0C\u6703\u7B49\u5230\u53EF\u64CD\u4F5C\u6642\u624D\u9EDE\u9078\u3002</p>
            <p class="note">\u95DC\u9589\u300C\u5148\u62FF\u9F4A\u300D\u6642\uFF0C\u6280\u80FD\u5148\u6BD4\u9806\u4F4D\uFF0C\u518D\u6BD4\u7A00\u6709\u5EA6\uFF1B\u5BF6\u7BB1\u6E05\u55AE\u5167\u5148\u6BD4\u54C1\u8CEA\uFF08\u7A00\u6709\u5EA6\uFF09\uFF0C\u518D\u6BD4\u9806\u4F4D\u3002\u7686\u76F8\u540C\u6642\u7531\u5DE6\u81F3\u53F3\u3002\u5BF6\u7BB1\u540D\u7A31\u6703\u5FFD\u7565\u7D50\u5C3E\u7684 +1\u3001+2 \u7B49\u5F37\u5316\u6578\u5B57\uFF1B\u5207\u63DB\u8A9E\u8A00\u5F8C\u8ACB\u78BA\u8A8D\u6E05\u55AE\u3002</p>
          </details>
          <details class="section"><summary>\u672C\u5206\u9801\u7D00\u9304\uFF08\u6700\u8FD1 30 \u7B46\uFF09</summary><div id="logs" class="log"></div><button id="clear-logs">\u6E05\u9664\u7D00\u9304</button></details>
          <footer>\u8A2D\u5B9A\u5132\u5B58\u5728\u6B64\u700F\u89BD\u5668\u3002\u81EA\u52D5\u9078\u724C\u958B\u95DC\u53EA\u4F5C\u7528\u65BC\u76EE\u524D\u5206\u9801\u3002</footer>
        </div>
      </section>`;
      document.documentElement.append(host);
      this.shadow.addEventListener("keydown", (event) => event.stopPropagation());
      for (const name of ["pointerdown", "pointerup", "click", "wheel"]) this.shadow.addEventListener(name, (event) => event.stopPropagation());
      this.on("launcher", "click", () => this.show());
      this.on("collapse", "click", () => this.show(false));
      this.on("toggle", "click", () => actions.enable(!this.state?.enabled));
      this.on("loop-stage", "change", () => {
        this.settings.loopStageName = this.input("loop-stage").value.trim().slice(0, 120);
        this.commit();
      });
      this.on("loop-capture", "click", () => {
        const name = currentStageName();
        if (!name) {
          this.el("loop-status").textContent = "\u8ACB\u5148\u958B\u555F\u968A\u9577\u95DC\u5361\u9078\u55AE\uFF0C\u6216\u5728\u6230\u9B25\u4E2D\u8B80\u53D6\u76EE\u524D\u95DC\u5361\u3002";
          return;
        }
        this.settings.loopStageName = name.slice(0, 120);
        this.commit();
        this.el("loop-status").textContent = `\u5DF2\u8A2D\u5B9A\u300C${name}\u300D`;
      });
      this.on("loop-toggle", "click", () => actions.loop(!this.loopState?.enabled));
      this.on("manage", "click", () => {
        const editor = this.el("profile-editor");
        editor.hidden = !editor.hidden;
        this.input("profile-name").value = this.profile().name;
      });
      this.on("profiles", "change", () => {
        this.settings.activeProfileId = this.select("profiles").value;
        this.commit();
      });
      for (const kind of ["levelup", "chest"]) this.on(`kind-${kind}`, "click", () => {
        this.editingKind = kind;
        this.input("card-name").value = "";
        this.message("");
        this.renderSettings();
      });
      this.on("new-profile", "click", () => {
        const name = this.input("profile-name").value.trim();
        if (!name) return this.message("\u8ACB\u8F38\u5165\u6E05\u55AE\u540D\u7A31\u3002");
        if (this.settings.profiles.length >= 20) return this.message("\u6700\u591A\u53EF\u5EFA\u7ACB 20 \u7D44\u6E05\u55AE\u3002");
        const id = crypto.randomUUID();
        this.settings.profiles.push({ id, name, priorities: [], chestPriorities: [] });
        this.settings.activeProfileId = id;
        this.commit();
        this.message("\u5DF2\u5EFA\u7ACB\u65B0\u6E05\u55AE\u3002");
      });
      this.on("rename-profile", "click", () => {
        const name = this.input("profile-name").value.trim();
        if (!name) return this.message("\u8ACB\u8F38\u5165\u6E05\u55AE\u540D\u7A31\u3002");
        this.profile().name = name;
        this.commit();
        this.message("\u5DF2\u66F4\u65B0\u6E05\u55AE\u540D\u7A31\u3002");
      });
      this.on("delete-profile", "click", () => {
        if (this.settings.profiles.length === 1) return this.message("\u81F3\u5C11\u4FDD\u7559\u4E00\u7D44\u6E05\u55AE\u3002");
        this.settings.profiles = this.settings.profiles.filter((p) => p.id !== this.settings.activeProfileId);
        this.settings.activeProfileId = this.settings.profiles[0].id;
        this.commit();
        this.message("\u5DF2\u522A\u9664\u6E05\u55AE\u3002");
      });
      this.on("add-form", "submit", (event) => {
        event.preventDefault();
        if (this.addName(this.input("card-name").value)) this.input("card-name").value = "";
      });
      this.on("fallback", "change", () => {
        this.settings.fallback = this.select("fallback").value === "rarity" ? "rarity" : "pause";
        this.commit();
      });
      this.on("chest-fallback", "change", () => {
        this.settings.chestFallback = this.select("chest-fallback").value === "rarity" ? "rarity" : "pause";
        this.commit();
      });
      this.on("chest-replace", "change", () => {
        this.settings.chestAutoReplace = this.input("chest-replace").checked;
        this.commit();
      });
      for (const [id, key] of [["prefer-new-skills", "preferNewSkills"], ["auto-collect-loot", "autoCollectLoot"], ["auto-focus", "autoFocusFirst"], ["auto-banish", "autoBanishLastTwo"], ["auto-reroll", "autoReroll"], ["chest-auto-reroll", "chestAutoReroll"]]) {
        this.on(id, "change", () => {
          this.settings[key] = this.input(id).checked;
          this.commit();
        });
      }
      for (const side of ["min", "max"]) this.on(`delay-${side}`, "change", () => {
        const field = this.input(`delay-${side}`);
        const n = field.valueAsNumber;
        const value = Number.isFinite(n) ? Math.round(Math.max(500, Math.min(5e3, n))) : side === "min" ? 500 : 1500;
        if (side === "min") {
          this.settings.delayMinMs = value;
          this.settings.delayMaxMs = Math.max(value, this.settings.delayMaxMs);
        } else {
          this.settings.delayMaxMs = value;
          this.settings.delayMinMs = Math.min(value, this.settings.delayMinMs);
        }
        this.commit();
      });
      this.on("clear-logs", "click", () => actions.clearLogs());
      this.renderSettings();
    }
    actions;
    shadow;
    settings;
    state = null;
    currentKey = "";
    logKey = "";
    dragged = -1;
    expanded = false;
    editingKind = "levelup";
    lastRoundKind = "";
    loopState = null;
    stagesKey = "";
    el(id) {
      return this.shadow.getElementById(id);
    }
    input(id) {
      return this.el(id);
    }
    select(id) {
      return this.el(id);
    }
    on(id, type, handler) {
      this.el(id).addEventListener(type, handler);
    }
    profile() {
      return this.settings.profiles.find((p) => p.id === this.settings.activeProfileId);
    }
    names(kind = this.editingKind) {
      return kind === "chest" ? this.profile().chestPriorities : this.profile().priorities;
    }
    message(message) {
      this.el("message").textContent = message;
    }
    show(expanded = true) {
      this.expanded = expanded;
      this.el("panel").hidden = !expanded;
      this.el("launcher").hidden = expanded;
    }
    commit() {
      this.renderSettings();
      this.actions.save(structuredClone(this.settings));
    }
    setSettings(settings) {
      this.settings = structuredClone(settings);
      this.renderSettings();
    }
    addName(value, kind = this.editingKind) {
      const name = priorityName(value, kind);
      if (!name) {
        this.message("\u8ACB\u8F38\u5165\u5361\u724C\u540D\u7A31\u3002");
        return false;
      }
      if (this.names(kind).some((n) => normalizeName(n) === normalizeName(name))) {
        this.message("\u9019\u5F35\u5361\u724C\u5DF2\u5728\u6E05\u55AE\u4E2D\u3002");
        return false;
      }
      if (this.names(kind).length >= 200) {
        this.message("\u6BCF\u7D44\u6E05\u55AE\u6700\u591A 200 \u5F35\u3002");
        return false;
      }
      const names = uniqueNames([...this.names(kind), name]);
      if (kind === "chest") this.profile().chestPriorities = names;
      else this.profile().priorities = names;
      this.editingKind = kind;
      this.commit();
      this.message(`\u5DF2\u52A0\u5165\u300C${name}\u300D\u3002`);
      return true;
    }
    move(from, to) {
      const names = this.names();
      if (from < 0 || to < 0 || from >= names.length || to >= names.length || from === to) return;
      names.splice(to, 0, names.splice(from, 1)[0]);
      this.commit();
    }
    renderSettings() {
      const select = this.select("profiles");
      select.replaceChildren();
      for (const p of this.settings.profiles) {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.name;
        select.append(option);
      }
      select.value = this.settings.activeProfileId;
      this.select("fallback").value = this.settings.fallback;
      this.select("chest-fallback").value = this.settings.chestFallback;
      this.input("chest-replace").checked = this.settings.chestAutoReplace;
      this.input("auto-focus").checked = this.settings.autoFocusFirst;
      this.input("auto-banish").checked = this.settings.autoBanishLastTwo;
      this.input("auto-reroll").checked = this.settings.autoReroll;
      this.input("chest-auto-reroll").checked = this.settings.chestAutoReroll;
      this.input("prefer-new-skills").checked = this.settings.preferNewSkills;
      this.input("auto-collect-loot").checked = this.settings.autoCollectLoot;
      this.input("delay-min").value = String(this.settings.delayMinMs);
      this.input("delay-max").value = String(this.settings.delayMaxMs);
      if (this.shadow.activeElement !== this.input("loop-stage")) this.input("loop-stage").value = this.settings.loopStageName;
      for (const kind of ["levelup", "chest"]) this.el(`kind-${kind}`).setAttribute("aria-pressed", String(kind === this.editingKind));
      this.el("priority-help").textContent = this.editingKind === "chest" ? "\u6E05\u55AE\u5167\u5148\u9078\u54C1\u8CEA\u6700\u9AD8\u7684\u9053\u5177\uFF0C\u54C1\u8CEA\u76F8\u540C\u624D\u4F9D\u9806\u4F4D\u3002\u62D6\u66F3\u6216\u4F7F\u7528 \u2191 \u2193 \u6392\u5E8F\u3002" : this.settings.preferNewSkills ? "\u6E05\u55AE\u5167\u6A58\u8272\u512A\u5148 \u2192 \u5C1A\u672A\u53D6\u5F97 \u2192 \u539F\u9806\u4F4D\u3002\u540C\u985E\u5019\u9078\u7531\u4E0A\u5230\u4E0B\u512A\u5148\u3002" : "\u7531\u4E0A\u5230\u4E0B\u4F9D\u5E8F\u512A\u5148\u3002\u62D6\u66F3\u6216\u4F7F\u7528 \u2191 \u2193 \u6392\u5E8F\u3002";
      this.el("empty-priorities").textContent = this.editingKind === "chest" ? "\u5C1A\u672A\u8A2D\u5B9A\u5BF6\u7BB1\u9806\u4F4D\u3002\u53EF\u5F9E\u76EE\u524D\u5BF6\u7BB1\u52A0\u5165\uFF0C\u6216\u5728\u9078\u724C\u8A2D\u5B9A\u6539\u7528\u6700\u9AD8\u7A00\u6709\u5EA6\u3002" : "\u9084\u6C92\u6709\u512A\u5148\u6280\u80FD\u3002\u8F38\u5165\u904A\u6232\u986F\u793A\u7684\u540D\u7A31\uFF0C\u6216\u5F9E\u4E0B\u65B9\u76EE\u524D\u9078\u724C\u52A0\u5165\u3002";
      const names = this.names();
      this.el("empty-priorities").hidden = names.length > 0;
      const list = this.el("priorities");
      list.replaceChildren();
      const rules = skillRules(this.settings);
      names.forEach((name, index) => {
        const item = document.createElement("li");
        item.className = "priority";
        item.draggable = true;
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = String(index + 1);
        const label = document.createElement("span");
        label.className = "name";
        label.textContent = name;
        item.append(rank, label);
        if (this.editingKind === "levelup") {
          const role = rules.focus === name ? "\u5C08\u6CE8" : rules.banishAfterLearning.includes(name) ? "\u53D6\u5F97\u5F8C\u653E\u9010" : "";
          if (role) {
            const tag = document.createElement("span");
            tag.className = `rule-tag ${role === "\u53D6\u5F97\u5F8C\u653E\u9010" ? "banish" : ""}`;
            tag.textContent = role;
            item.append(tag);
          }
        }
        for (const [symbol, title, target] of [["\u2191", "\u4E0A\u79FB", index - 1], ["\u2193", "\u4E0B\u79FB", index + 1], ["\xD7", "\u79FB\u9664", -1]]) {
          const button = document.createElement("button");
          button.className = "icon";
          button.textContent = symbol;
          button.setAttribute("aria-label", `${title} ${name}`);
          button.disabled = symbol !== "\xD7" && (target < 0 || target >= names.length);
          button.addEventListener("click", () => {
            if (symbol === "\xD7") {
              names.splice(index, 1);
              this.commit();
            } else this.move(index, target);
          });
          item.append(button);
        }
        item.addEventListener("dragstart", (event) => {
          this.dragged = index;
          event.dataTransfer?.setData("text/plain", String(index));
        });
        item.addEventListener("dragover", (event) => {
          event.preventDefault();
          item.classList.add("drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          item.classList.remove("drag-over");
          this.move(this.dragged, index);
          this.dragged = -1;
        });
        item.addEventListener("dragend", () => {
          this.dragged = -1;
        });
        list.append(item);
      });
      this.currentKey = "";
      if (this.state) this.update(this.state);
    }
    update(state) {
      this.state = state;
      const stages = stageChoices().filter((stage) => stage.available).map((stage) => stage.name);
      if (stages.length && JSON.stringify(stages) !== this.stagesKey) {
        this.stagesKey = JSON.stringify(stages);
        this.el("loop-stages").replaceChildren(...stages.map((name) => {
          const option = document.createElement("option");
          option.value = name;
          return option;
        }));
      }
      const kind = state.snapshot?.kind;
      if (kind !== this.lastRoundKind) {
        this.lastRoundKind = kind ?? "";
        if ((kind === "levelup" || kind === "chest") && this.editingKind !== kind && this.shadow.activeElement?.tagName !== "INPUT") {
          this.editingKind = kind;
          this.renderSettings();
          return;
        }
      }
      this.el("status").textContent = state.status;
      this.el("mode").textContent = state.enabled ? "AUTO / \u81EA\u52D5\u9078\u724C" : "PREVIEW / \u9810\u89BD";
      this.el("mode").classList.toggle("on", state.enabled);
      this.el("toggle").textContent = state.enabled ? "\u66AB\u505C\u81EA\u52D5\u9078\u724C" : "\u555F\u7528\u81EA\u52D5\u9078\u724C";
      if (this.loopState?.enabled) this.el("toggle").textContent = "\u5168\u90E8\u66AB\u505C";
      this.el("toggle").classList.toggle("pause", state.enabled);
      this.el("launcher").classList.toggle("active", state.enabled);
      this.el("launcher").textContent = this.loopState?.enabled ? "\u9078\u724C\u52A9\u624B \xB7 \u5FAA\u74B0\u4E2D" : state.enabled ? "\u9078\u724C\u52A9\u624B \xB7 \u81EA\u52D5" : "\u2667 \u9078\u724C\u52A9\u624B";
      this.el("timer").textContent = state.snapshot?.timer ? `${state.snapshot.timer} \xB7 \u904A\u6232\u5012\u6578\u4ECD\u6703\u7E7C\u7E8C\uFF0C\u903E\u6642\u53EF\u80FD\u81EA\u884C\u9078\u724C\u3002` : "";
      const key = JSON.stringify([state.snapshot?.signature, state.snapshot?.closing, state.recommendation, this.profile().priorities, this.profile().chestPriorities]);
      if (key !== this.currentKey) {
        this.currentKey = key;
        const target = this.el("current");
        target.replaceChildren();
        if (!state.snapshot?.cards.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "\u5347\u7D1A\u6216\u5BF6\u7BB1\u9078\u724C\u51FA\u73FE\u5F8C\uFF0C\u6703\u5728\u9019\u88E1\u986F\u793A\u3002";
          target.append(empty);
        } else {
          state.snapshot.cards.forEach((card, index) => {
            const recommended = index === state.recommendation.index && !state.snapshot?.closing;
            const block = document.createElement("div");
            block.className = `card${recommended ? " recommended" : ""}`;
            const row = document.createElement("div");
            row.className = "row";
            const name = document.createElement("strong");
            name.textContent = `${index + 1}. ${card.name || "\u7121\u6CD5\u8FA8\u8B58\u540D\u7A31"}`;
            const add = document.createElement("button");
            add.setAttribute("aria-label", `\u52A0\u5165 ${card.name} \u5230\u6E05\u55AE`);
            const cardKind = state.snapshot.kind;
            const supported = cardKind === "levelup" || cardKind === "chest";
            const alreadyAdded = supported && this.names(cardKind).some((n) => normalizeName(n) === normalizeName(priorityName(card.name, cardKind)));
            add.disabled = !supported || !card.name || alreadyAdded;
            add.textContent = alreadyAdded ? "\u5DF2\u52A0\u5165" : !supported ? "\u672A\u652F\u63F4" : !card.name ? "\u7121\u540D\u7A31" : "\uFF0B\u6E05\u55AE";
            add.title = alreadyAdded ? `\u5DF2\u5728${cardKind === "chest" ? "\u5BF6\u7BB1\u9053\u5177" : "\u5347\u7D1A\u6280\u80FD"}\u6E05\u55AE\u4E2D` : !supported ? "\u5C1A\u672A\u8FA8\u8B58\u6B64\u9078\u724C\u756B\u9762\uFF0C\u8ACB\u624B\u52D5\u8F38\u5165\u540D\u7A31\u52A0\u5165\u6E05\u55AE" : !card.name ? "\u7121\u6CD5\u8B80\u53D6\u5361\u724C\u540D\u7A31" : `\u52A0\u5165${cardKind === "chest" ? "\u5BF6\u7BB1\u9053\u5177" : "\u5347\u7D1A\u6280\u80FD"}\u6E05\u55AE`;
            add.addEventListener("click", () => {
              if (supported) this.addName(card.name, cardKind);
            });
            row.append(name, add);
            block.append(row);
            const skillStatus = cardKind !== "levelup" ? "" : card.skillState === "new" ? "\u5C1A\u672A\u53D6\u5F97" : card.skillState === "owned" ? "\u5DF2\u53D6\u5F97\u30FB\u5347\u7D1A\u724C" : "\u53D6\u5F97\u72C0\u614B\u672A\u77E5";
            const detail = document.createElement("small");
            detail.textContent = [skillStatus, card.badge, card.details, card.requiresConfirmation ? "\u5C07\u66FF\u63DB\u539F\u6709\u9053\u5177" : ""].filter(Boolean).join(" \xB7 ");
            block.append(detail);
            if (recommended) {
              const why = document.createElement("div");
              why.className = "reason";
              why.textContent = `\u63A8\u85A6 \xB7 ${state.recommendation.reason}`;
              block.append(why);
            }
            target.append(block);
          });
        }
      }
      const logKey = JSON.stringify(state.logs);
      if (logKey !== this.logKey) {
        this.logKey = logKey;
        const logs = this.el("logs");
        logs.replaceChildren();
        if (!state.logs.length) {
          const empty = document.createElement("p");
          empty.textContent = "\u5C1A\u7121\u9078\u724C\u7D00\u9304\u3002";
          logs.append(empty);
        }
        for (const entry of state.logs) {
          const p = document.createElement("p");
          const time = document.createElement("time");
          time.textContent = entry.time;
          p.append(time, document.createTextNode(entry.text));
          logs.append(p);
        }
      }
    }
    updateLoop(state) {
      this.loopState = state;
      this.el("loop-toggle").textContent = state.enabled ? "\u66AB\u505C\u5FAA\u74B0\u8207\u9078\u724C" : "\u555F\u7528\u5FAA\u74B0\u5237\u95DC";
      this.el("loop-toggle").classList.toggle("pause", state.enabled);
      this.el("loop-status").textContent = state.status;
      this.el("loop-count").textContent = `\u672C\u5206\u9801\u5DF2\u7D50\u7B97 ${state.completed} \u5834`;
      const logs = this.el("loop-logs");
      if (logs.dataset.entries !== JSON.stringify(state.logs)) {
        logs.dataset.entries = JSON.stringify(state.logs);
        logs.replaceChildren(...state.logs.map((text2) => {
          const p = document.createElement("p");
          p.textContent = text2;
          return p;
        }));
      }
      if (this.state) this.update(this.state);
    }
  };

  // src/storage.ts
  async function loadSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return sanitizeSettings(result[STORAGE_KEY]);
  }
  async function saveSettings(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: sanitizeSettings(settings) });
  }

  // src/run-loop.ts
  var RunLoop = class {
    state = { enabled: false, status: "\u5FAA\u74B0\u5C1A\u672A\u555F\u7528", completed: 0, logs: [] };
    stageName;
    listeners = /* @__PURE__ */ new Set();
    candidate = null;
    attempt = null;
    ownDifficulty = false;
    difficultyButton = null;
    stalledAt = 0;
    stalledKey = "";
    constructor(stageName) {
      this.stageName = stageName;
      setInterval(() => this.tick(), 250);
      document.addEventListener("visibilitychange", () => {
        this.candidate = null;
        this.stalledAt = performance.now();
        if (this.attempt) this.attempt.at = performance.now();
        this.tick();
      });
      document.addEventListener("click", (event) => {
        if (this.state.enabled && event.isTrusted && event.target instanceof Element && event.target.closest("#stages button, #npc-options button, #btn-restart, #lobby-prompt, #lobby-switch")) {
          this.stop("\u5DF2\u4EA4\u7531\u4F60\u64CD\u4F5C\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C");
        }
      }, true);
      document.addEventListener("input", (event) => {
        if (this.state.enabled && event.isTrusted && event.target instanceof Element && event.target.closest("#npc-text .diff input")) this.stop("\u5DF2\u4EA4\u7531\u4F60\u8ABF\u6574\u96E3\u5EA6\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C");
      }, true);
      document.addEventListener("keydown", (event) => {
        if (this.state.enabled && event.isTrusted && ["Escape", "Enter", " "].includes(event.key) && !event.composedPath().some((node) => node instanceof HTMLElement && node.id === "ro-picker-assistant") && ["stages", "dialog", "settlement"].includes(readRunScreen().kind)) this.stop("\u5DF2\u4EA4\u7531\u4F60\u64CD\u4F5C\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C");
      }, true);
    }
    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.state);
    }
    status(text2) {
      this.state.status = text2;
      this.listeners.forEach((listener) => listener(this.state));
    }
    log(text2) {
      this.state.logs.unshift(`${(/* @__PURE__ */ new Date()).toLocaleTimeString("zh-TW", { hour12: false })} ${text2}`);
      this.state.logs.length = Math.min(12, this.state.logs.length);
    }
    updateStage(name) {
      if (name === this.stageName) return;
      this.stageName = name;
      if (this.state.enabled) this.stop("\u76EE\u6A19\u95DC\u5361\u5DF2\u8B8A\u66F4\uFF0C\u8ACB\u91CD\u65B0\u555F\u7528\u5FAA\u74B0");
    }
    start() {
      if (!this.stageName.trim()) {
        this.stop("\u8ACB\u5148\u8A2D\u5B9A\u5FAA\u74B0\u95DC\u5361");
        return;
      }
      this.candidate = null;
      this.attempt = null;
      this.ownDifficulty = false;
      this.difficultyButton = null;
      this.stalledKey = "";
      this.state.enabled = true;
      this.log(`\u555F\u7528\u5FAA\u74B0\uFF1A${this.stageName}`);
      this.tick();
    }
    stop(message = "\u5FAA\u74B0\u5DF2\u66AB\u505C") {
      this.state.enabled = false;
      this.candidate = null;
      this.attempt = null;
      this.ownDifficulty = false;
      this.difficultyButton = null;
      this.log(message);
      this.status(message);
    }
    matches(name) {
      return normalizeName(name) === normalizeName(this.stageName);
    }
    acknowledged(screen) {
      switch (this.attempt?.expected) {
        case "lobby":
          return screen.kind === "lobby";
        case "stages":
          return screen.kind === "stages";
        case "selected":
          return screen.kind === "stages" && stageChoices().some((stage) => stage.selected && this.matches(stage.name)) && this.matches(selectedStageName());
        case "difficulty":
          return screen.kind === "dialog";
        case "battle":
          return screen.kind === "battle";
        default:
          return false;
      }
    }
    wait(key, message, timeout = 15e3) {
      this.candidate = null;
      if (key !== this.stalledKey) {
        this.stalledKey = key;
        this.stalledAt = performance.now();
      }
      if (performance.now() - this.stalledAt >= timeout) this.stop(`${message}\uFF1B\u7B49\u5F85\u903E\u6642\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C`);
      else this.status(message);
    }
    click(key, button, label, expected, delay = 750) {
      this.stalledKey = "";
      if (this.candidate?.key !== key || this.candidate.button !== button) this.candidate = { key, button, at: performance.now() };
      if (performance.now() - this.candidate.at < delay) {
        this.status(`\u5373\u5C07${label}`);
        return;
      }
      this.candidate = null;
      this.attempt = { expected, at: performance.now(), timeout: expected === "battle" || expected === "lobby" ? 9e4 : 8e3, label };
      this.log(label);
      this.status(`\u7B49\u5F85\u904A\u6232\u78BA\u8A8D\uFF1A${label}`);
      button.click();
    }
    tick() {
      if (!this.state.enabled) return;
      if (document.visibilityState !== "visible") {
        this.candidate = null;
        this.stalledAt = performance.now();
        if (this.attempt) this.attempt.at = performance.now();
        this.status("\u5206\u9801\u5728\u80CC\u666F \xB7 \u8FD4\u56DE\u5F8C\u7E7C\u7E8C\u5FAA\u74B0");
        return;
      }
      const screen = readRunScreen();
      if (screen.kind === "blocked") {
        this.stop(`\u300C${screen.label}\u300D\u9700\u8981\u624B\u52D5\u8655\u7406\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C`);
        return;
      }
      if (screen.kind === "loot") {
        this.wait("loot", "\u7B49\u5F85\u6389\u843D\u63D0\u793A\u95DC\u9589", 9e4);
        return;
      }
      if (this.attempt) {
        if (this.acknowledged(screen)) {
          if (this.attempt.expected === "lobby") {
            this.state.completed++;
            this.log(`\u5DF2\u7D50\u7B97 ${this.state.completed} \u5834\uFF0C\u56DE\u5230\u57CE\u93AE`);
          }
          if (this.attempt.expected === "difficulty") {
            this.ownDifficulty = true;
            this.difficultyButton = difficultyConfirmation();
          }
          if (this.attempt.expected === "battle") {
            this.ownDifficulty = false;
            this.log(`\u5DF2\u9032\u5165\u300C${this.stageName}\u300D`);
          }
          this.attempt = null;
          this.stalledKey = "";
        } else {
          if (screen.kind === "dialog") {
            this.stop(`\u300C${screen.label || "\u904A\u6232\u5C0D\u8A71"}\u300D\u9700\u8981\u624B\u52D5\u8655\u7406\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C`);
            return;
          }
          if (performance.now() - this.attempt.at >= this.attempt.timeout) this.stop(`\u904A\u6232\u672A\u78BA\u8A8D\u300C${this.attempt.label}\u300D\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C`);
          else this.status(`\u7B49\u5F85\u904A\u6232\u78BA\u8A8D\uFF1A${this.attempt.label}`);
          return;
        }
      }
      if (screen.kind !== "dialog") this.ownDifficulty = false;
      if (screen.kind === "battle") {
        this.candidate = null;
        this.stalledKey = "";
        this.status(`\u6230\u9B25\u4E2D \xB7 \u7D50\u7B97\u5F8C\u524D\u5F80\u300C${this.stageName}\u300D`);
        return;
      }
      if (screen.kind === "settlement") {
        const button = usableButton("btn-restart");
        if (button) this.click("return", button, "\u5B8C\u6210\u7D50\u7B97\u4E26\u56DE\u57CE", "lobby", 2500);
        else this.wait("settlement", "\u7B49\u5F85\u7D50\u7B97\u6309\u9215\u5C31\u7DD2");
        return;
      }
      if (screen.kind === "lobby") {
        const button = captainPrompt();
        if (button) this.click("captain", button, "\u8207\u9060\u5F81\u968A\u9577\u4EA4\u8AC7", "stages");
        else this.wait("captain", "\u5C1A\u672A\u627E\u5230\u968A\u9577\u4EA4\u8AC7\u6309\u9215\uFF0C\u8ACB\u9760\u8FD1\u9060\u5F81\u968A\u9577");
        return;
      }
      if (screen.kind === "stages") {
        const matches = stageChoices().filter((stage) => this.matches(stage.name));
        if (matches.length !== 1) {
          this.stop(`\u627E\u4E0D\u5230\u552F\u4E00\u7684\u95DC\u5361\u300C${this.stageName}\u300D\uFF0C\u8ACB\u78BA\u8A8D\u5B8C\u6574\u540D\u7A31`);
          return;
        }
        const target = matches[0];
        if (!target.available) {
          this.stop(`\u300C${this.stageName}\u300D\u5C1A\u672A\u89E3\u9396\u6216\u672A\u958B\u653E\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C`);
          return;
        }
        if (!target.selected || !this.matches(selectedStageName())) {
          this.click("select-stage", target.element, `\u9078\u64C7\u300C${target.name}\u300D`, "selected");
          return;
        }
        const button = departureButton();
        if (!button) {
          this.stop(`\u300C${this.stageName}\u300D\u76EE\u524D\u7121\u6CD5\u51FA\u767C\uFF0C\u8ACB\u5148\u5B8C\u6210\u9700\u6C42\u6216\u5287\u60C5`);
          return;
        }
        this.click("depart", button, `\u5F9E\u300C${this.stageName}\u300D\u51FA\u767C`, "difficulty");
        return;
      }
      if (screen.kind === "dialog") {
        const button = this.ownDifficulty ? difficultyConfirmation() : null;
        if (button && button === this.difficultyButton) this.click("difficulty", button, "\u6CBF\u7528\u76EE\u524D\u96E3\u5EA6\u9032\u5165\u6230\u9B25", "battle");
        else this.stop(`\u300C${screen.label || "\u904A\u6232\u5C0D\u8A71"}\u300D\u9700\u8981\u624B\u52D5\u8655\u7406\uFF0C\u8ACB\u8FD4\u56DE\u95DC\u5361\u9078\u55AE\u5F8C\u91CD\u65B0\u555F\u7528\u5FAA\u74B0`);
        return;
      }
      this.wait(screen.kind, screen.kind === "loading" ? "\u7B49\u5F85\u904A\u6232\u8F09\u5165" : "\u7B49\u5F85\u57CE\u93AE\u3001\u6230\u9B25\u6216\u7D50\u7B97\u756B\u9762", screen.kind === "loading" ? 9e4 : 15e3);
    }
  };

  // src/content.ts
  async function main() {
    if (document.getElementById("ro-picker-assistant")) return;
    const settings = await loadSettings();
    const engine = new PickerEngine(settings);
    const loop = new RunLoop(settings.loopStageName);
    const pauseAll = () => {
      if (loop.state.enabled) loop.stop();
      if (engine.state.enabled) engine.setEnabled(false);
    };
    let pendingSave = Promise.resolve();
    const panel = new Panel(structuredClone(settings), {
      save(next) {
        engine.updateSettings(next);
        loop.updateStage(next.loopStageName);
        pendingSave = pendingSave.then(() => saveSettings(next)).catch(() => {
          engine.pauseWithError("\u8A2D\u5B9A\u5132\u5B58\u5931\u6557\uFF0C\u5DF2\u66AB\u505C\u3002\u8ACB\u91CD\u65B0\u6574\u7406\u904A\u6232\u5F8C\u518D\u8A66\u3002");
          if (loop.state.enabled) loop.stop("\u8A2D\u5B9A\u5132\u5B58\u5931\u6557\uFF0C\u5FAA\u74B0\u5DF2\u66AB\u505C");
          panel.message("\u8A2D\u5B9A\u672A\u5132\u5B58\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u78BA\u8A8D\u6E05\u55AE\u3002");
        });
      },
      enable: (enabled) => enabled ? engine.setEnabled(true) : pauseAll(),
      clearLogs: () => engine.clearLogs(),
      loop(enabled) {
        if (!enabled) {
          pauseAll();
          return;
        }
        loop.start();
        if (loop.state.enabled) engine.setEnabled(true);
      }
    });
    const style = document.createElement("style");
    style.textContent = '#picker .pk-card[data-ro-recommended="true"] { outline: 3px solid #77dbbb !important; outline-offset: 4px !important; }';
    document.documentElement.append(style);
    let highlighted = null;
    engine.subscribe((state) => {
      if (!state.enabled && loop.state.enabled) loop.stop("\u81EA\u52D5\u9078\u724C\u5DF2\u505C\u6B62\uFF0C\u5FAA\u74B0\u4E00\u4F75\u66AB\u505C");
      panel.update(state);
      const index = state.recommendation.index;
      const target = index !== null && !state.snapshot?.closing ? state.snapshot?.cards[index]?.element ?? null : null;
      if (highlighted !== target) {
        highlighted?.removeAttribute("data-ro-recommended");
        target?.setAttribute("data-ro-recommended", "true");
        highlighted = target;
      }
    });
    let wasLoopEnabled = false;
    loop.subscribe((state) => {
      if (wasLoopEnabled && !state.enabled && engine.state.enabled) engine.setEnabled(false);
      wasLoopEnabled = state.enabled;
      panel.updateLoop(state);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        const next = sanitizeSettings(changes[STORAGE_KEY].newValue);
        engine.updateSettings(next);
        loop.updateStage(next.loopStageName);
        panel.setSettings(next);
      }
    });
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message?.type === "RO_PICKER_SHOW") {
        panel.show();
        respond({ ok: true });
      } else if (message?.type === "RO_PICKER_STATUS") respond({ enabled: engine.state.enabled || loop.state.enabled, status: loop.state.enabled ? `${loop.state.status} \xB7 \u5DF2\u7D50\u7B97 ${loop.state.completed} \u5834` : engine.state.status });
      else if (message?.type === "RO_PICKER_PAUSE") {
        pauseAll();
        respond({ ok: true });
      }
    });
  }
  void main().catch((error) => console.error("[RO \u9078\u724C\u52A9\u624B] \u555F\u52D5\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\u3002", error));
})();
