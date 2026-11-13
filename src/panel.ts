import styles from './panel.css';
import { emptyProfile, minWalkIntervalMs, normalizeName, priorityName, uniqueNames, validWalkSetting } from './core';
import type { PickKind, Settings, ViewState } from './types';
import { currentStageName, stageChoices } from './run-adapter';
import type { LoopState } from './run-loop';
import { rollCategories, rollCategoryKeys } from './roll-rules';

interface Actions {
  save(settings: Settings): void;
  enable(enabled: boolean): void;
  clearLogs(): void;
  loop(enabled: boolean): void;
  walk(enabled: boolean): void;
  pauseAll(): void;
}
export class Panel {
  private shadow: ShadowRoot;
  private settings: Settings;
  private state: ViewState | null = null;
  private currentKey = '';
  private logKey = '';
  private dragged = -1;
  private editingKind: PickKind = 'levelup';
  private lastRoundKind = '';
  private loopState: LoopState | null = null;
  private walking = false;
  private stagesKey = '';
  constructor(settings: Settings, private actions: Actions) {
    this.settings = settings;
    const host = document.createElement('div');
    host.id = 'ro-picker-assistant';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    this.shadow = host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>${styles}\n.panel,.launcher { pointer-events:auto; }</style>
      <button class="launcher" id="launcher" aria-label="開啟 RO 選牌助手">♧ 選牌助手</button>
      <section class="panel" id="panel" aria-label="RO 選牌助手" hidden>
        <header><span class="logo" aria-hidden="true">♧</span><div><strong>RO 選牌助手</strong><small>你的清單，你的打法 · v0.8.1</small></div><button class="icon" id="collapse" aria-label="收合面板">−</button></header>
        <div class="body">
          <section id="automation" aria-labelledby="automation-title">
            <div class="toolbar"><strong id="automation-title">自動功能</strong><button id="pause-all" disabled>全部暫停</button></div>
            <div class="checks run-checks">
              <label><input type="checkbox" id="toggle">自動選牌</label>
              <label><input type="checkbox" id="loop-toggle">循環刷關</label>
              <label><input type="checkbox" id="walk-toggle">小範圍走動</label>
            </div>
            <fieldset class="pick-rules"><legend>自動選牌啟用時</legend>
              <div class="checks">
                <label><input type="checkbox" id="auto-collect-loot">自動取得掉落物</label>
                <label><input type="checkbox" id="auto-roll-loot">組隊自動擲骰</label>
                <label><input type="checkbox" id="auto-reroll">技能未命中時重抽</label>
                <label><input type="checkbox" id="chest-auto-reroll">寶箱未命中時重抽</label>
                <label title="技能清單未命中且無法重抽時，選擇已辨識的最高稀有度"><input type="checkbox" id="fallback">技能未命中選最高稀有度</label>
                <label title="寶箱清單未命中且無法重抽時，選擇已辨識的最高稀有度"><input type="checkbox" id="chest-fallback">寶箱未命中選最高稀有度</label>
                <label title="清單內橘色技能優先，其次為尚未取得的技能"><input type="checkbox" id="prefer-new-skills">先拿齊清單技能</label>
                <label><input type="checkbox" id="chest-replace">寶箱自動確認替換</label>
              </div>
            </fieldset>
          </section>
          <span class="mode" id="mode">PREVIEW / 預覽</span>
          <p class="status" id="status" role="status" aria-live="polite"></p>
          <p class="status" id="walk-status" role="status" hidden></p>
          <p class="status" id="loop-status" role="status" hidden></p>
          <div class="timer" id="timer"></div>
          <details class="section" id="roll-settings"><summary>組隊分寶</summary>
            <p class="note">無法辨識種類的掉落物會套用「其他」。</p>
            <div class="roll-rules">${rollCategoryKeys.map(key => `
              <div><label for="roll-${key}">${rollCategories[key]}</label><select id="roll-${key}">
                <option value="need">Need（需求）</option><option value="greed">Greed（貪婪）</option>
              </select></div>`).join('')}</div>
          </details>
          <details class="section" id="walk-settings"><summary>小範圍走動</summary>
            <div class="row delay-range">
              <label>活動半徑（格）<input id="walk-radius" type="number" min="1" step="1" required></label>
              <label>步伐間隔（秒）<input id="walk-interval" type="number" min="${minWalkIntervalMs / 1000}" step="0.001" required></label>
            </div>
            <div id="walk-input-error" class="message" role="status"></div>
            <p class="note">可在城鎮先勾選。進入戰鬥後開始走動，結算回城後待命，下一場自動接續。手動移動時暫停，放開操作 10 秒後以當下位置為中心繼續走動。</p>
          </details>
          <details class="section" id="loop-settings"><summary>循環刷關 · 遠征隊長</summary>
            <label class="label" for="loop-stage">循環關卡</label>
            <input id="loop-stage" list="loop-stages" maxlength="120" placeholder="輸入遊戲中的完整關卡名稱" autocomplete="off">
            <datalist id="loop-stages"></datalist>
            <div class="row loop-actions"><button id="loop-capture">使用目前關卡</button></div>
            <p class="note" id="loop-count">本分頁已結算 0 場</p>
            <p class="note">可在關卡選單或戰鬥中讀取名稱；開啟隊長選單後也可從輸入框選關。沿用遊戲目前難度，勝利或死亡結算後等 2.5 秒回城，再次出發。啟用循環會一併啟用自動選牌。</p>
            <p class="note">回城若出現「選擇大廳」，會按「離線遊玩」再找隊長。若已離開出生點，請先靠近隊長。支援單人一般關卡，分頁需留在前景。遇到劇情或組隊對話會暫停。</p>
            <details><summary>最近循環紀錄</summary><div id="loop-logs" class="log"></div></details>
          </details>
          <div class="section">
            <label class="label" for="profiles">使用中的優先清單</label>
            <div class="row"><select id="profiles" aria-label="選擇優先清單"></select><button class="icon" id="manage" aria-label="管理清單">管理</button></div>
            <div class="profile-editor" id="profile-editor" hidden>
              <input id="profile-name" placeholder="清單名稱，例如：法師練等" maxlength="60" aria-label="清單名稱">
              <div class="row"><button id="new-profile">新增清單</button><button id="rename-profile">重新命名</button><button id="delete-profile">刪除此清單</button></div>
            </div>
            <div class="kind-tabs" role="group" aria-label="清單類型"><button id="kind-levelup" aria-pressed="true">升級技能</button><button id="kind-chest" aria-pressed="false">寶箱道具</button></div>
            <ol id="priorities" aria-label="卡牌優先順序"></ol>
            <div class="empty" id="empty-priorities">還沒有優先卡牌。輸入遊戲顯示的名稱，或從下方目前選牌加入。</div>
            <form id="add-form" class="row"><input id="card-name" placeholder="輸入完整卡牌名稱" maxlength="120" aria-label="卡牌名稱" autocomplete="off"><button type="submit">加入</button></form>
            <div class="note" id="priority-help" style="margin-top:6px"></div>
            <div class="message" id="message" role="status"></div>
          </div>
          <div class="section"><span class="label">目前選牌</span><div id="current" class="current"><div class="empty">升級或寶箱選牌出現後，會在這裡顯示。</div></div></div>
          <details class="section" id="advanced"><summary>選牌設定</summary>
            <div class="note" style="margin-top:12px">每輪隨機選牌延遲（毫秒）</div>
            <div class="row delay-range"><label for="delay-min">最短<input id="delay-min" type="number" min="500" max="5000" step="100"></label><span>～</span><label for="delay-max">最長<input id="delay-max" type="number" min="500" max="5000" step="100"></label></div>
            <p class="note">預設 500～1500 毫秒，每輪重新抽取一次。若遊戲動畫尚未結束，會等到可操作時才點選。</p>
            <p class="note">關閉「先拿齊」時，技能先比順位，再比稀有度；寶箱清單內先比品質（稀有度），再比順位。皆相同時由左至右。寶箱名稱會忽略結尾的 +1、+2 等強化數字；切換語言後請確認清單。</p>
          </details>
          <details class="section"><summary>本分頁紀錄（最近 30 筆）</summary><div id="logs" class="log"></div><button id="clear-logs">清除紀錄</button></details>
          <footer>選牌規則會儲存在此瀏覽器。重新整理後，請再勾選要啟動的功能。</footer>
        </div>
      </section>`;
    document.documentElement.append(host);
    this.shadow.addEventListener('keydown', event => event.stopPropagation());
    for (const name of ['pointerdown', 'pointerup', 'click', 'wheel']) this.shadow.addEventListener(name, event => event.stopPropagation());
    this.on('launcher', 'click', () => this.show());
    this.on('collapse', 'click', () => this.show(false));
    this.on('toggle', 'change', () => actions.enable(this.input('toggle').checked));
    this.on('pause-all', 'click', () => actions.pauseAll());
    this.on('walk-toggle', 'change', () => {
      actions.walk(this.input('walk-toggle').checked);
      this.input('walk-toggle').checked = this.walking;
    });
    for (const [id, key, scale] of [['walk-radius', 'walkRadius', 1], ['walk-interval', 'walkIntervalMs', 1000]] as const) {
      this.on(id, 'change', () => {
        const field = this.input(id);
        const value = Math.round(field.valueAsNumber * scale);
        if (!field.validity.valid || !validWalkSetting(key, value)) {
          field.value = String(this.settings[key] / scale);
          this.el('walk-input-error').textContent = key === 'walkRadius'
            ? '半徑請輸入至少 1 格的整數，已保留原設定。'
            : '間隔請輸入至少 0.1 秒，最多三位小數，已保留原設定。';
          return;
        }
        this.el('walk-input-error').textContent = '';
        this.settings[key] = value;
        this.commit();
      });
    }
    this.on('loop-stage', 'change', () => { this.settings.loopStageName = this.input('loop-stage').value.trim().slice(0, 120); this.commit(); });
    this.on('loop-capture', 'click', () => {
      this.el('loop-status').hidden = false;
      const name = currentStageName();
      if (!name) { this.el('loop-status').textContent = '請先開啟隊長關卡選單，或在戰鬥中讀取目前關卡。'; return; }
      this.settings.loopStageName = name.slice(0, 120); this.commit();
      this.el('loop-status').textContent = `已設定「${name}」`;
    });
    this.on('loop-toggle', 'change', () => actions.loop(this.input('loop-toggle').checked));
    this.on('manage', 'click', () => {
      const editor = this.el('profile-editor'); editor.hidden = !editor.hidden;
      this.input('profile-name').value = this.profile().name;
    });
    this.on('profiles', 'change', () => { this.settings.activeProfileId = this.select('profiles').value; this.commit(); });
    for (const kind of ['levelup', 'chest'] as const) this.on(`kind-${kind}`, 'click', () => {
      this.editingKind = kind; this.input('card-name').value = ''; this.message(''); this.renderSettings();
    });
    this.on('new-profile', 'click', () => {
      const name = this.input('profile-name').value.trim();
      if (!name) return this.message('請輸入清單名稱。');
      if (this.settings.profiles.length >= 20) return this.message('最多可建立 20 組清單。');
      const id = crypto.randomUUID();
      this.settings.profiles.push(emptyProfile(id, name)); this.settings.activeProfileId = id; this.commit();
      this.message('已建立新清單。');
    });
    this.on('rename-profile', 'click', () => {
      const name = this.input('profile-name').value.trim();
      if (!name) return this.message('請輸入清單名稱。');
      this.profile().name = name; this.commit(); this.message('已更新清單名稱。');
    });
    this.on('delete-profile', 'click', () => {
      if (this.settings.profiles.length === 1) return this.message('至少保留一組清單。');
      this.settings.profiles = this.settings.profiles.filter(p => p.id !== this.settings.activeProfileId);
      this.settings.activeProfileId = this.settings.profiles[0].id; this.commit(); this.message('已刪除清單。');
    });
    this.on('add-form', 'submit', event => {
      event.preventDefault();
      if (this.addName(this.input('card-name').value)) this.input('card-name').value = '';
    });
    this.on('fallback', 'change', () => {
      this.settings.fallback = this.input('fallback').checked ? 'rarity' : 'pause'; this.commit();
    });
    this.on('chest-fallback', 'change', () => {
      this.settings.chestFallback = this.input('chest-fallback').checked ? 'rarity' : 'pause'; this.commit();
    });
    this.on('chest-replace', 'change', () => { this.settings.chestAutoReplace = this.input('chest-replace').checked; this.commit(); });
    for (const category of rollCategoryKeys) {
      this.on(`roll-${category}`, 'change', () => {
        this.settings.rollRules[category] = this.select(`roll-${category}`).value === 'need' ? 'need' : 'greed';
        this.commit();
      });
    }
    for (const [id, key] of [['prefer-new-skills', 'preferNewSkills'], ['auto-collect-loot', 'autoCollectLoot'], ['auto-roll-loot', 'autoRollLoot'], ['auto-reroll', 'autoReroll'], ['chest-auto-reroll', 'chestAutoReroll']] as const) {
      this.on(id, 'change', () => { this.settings[key] = this.input(id).checked; this.commit(); });
    }
    for (const side of ['min', 'max'] as const) this.on(`delay-${side}`, 'change', () => {
      const field = this.input(`delay-${side}`);
      const n = field.valueAsNumber;
      const value = Number.isFinite(n) ? Math.round(Math.max(500, Math.min(5000, n))) : side === 'min' ? 500 : 1500;
      if (side === 'min') { this.settings.delayMinMs = value; this.settings.delayMaxMs = Math.max(value, this.settings.delayMaxMs); }
      else { this.settings.delayMaxMs = value; this.settings.delayMinMs = Math.min(value, this.settings.delayMinMs); }
      this.commit();
    });
    this.on('clear-logs', 'click', () => actions.clearLogs());
    this.renderSettings();
  }
  private el(id: string): HTMLElement { return this.shadow.getElementById(id)!; }
  private input(id: string): HTMLInputElement { return this.el(id) as HTMLInputElement; }
  private select(id: string): HTMLSelectElement { return this.el(id) as HTMLSelectElement; }
  private on(id: string, type: string, handler: (event: Event) => void): void { this.el(id).addEventListener(type, handler); }
  private profile() { return this.settings.profiles.find(p => p.id === this.settings.activeProfileId)!; }
  private names(kind: PickKind = this.editingKind): string[] { return kind === 'chest' ? this.profile().chestPriorities : this.profile().priorities; }
  message(message: string): void { this.el('message').textContent = message; }
  show(expanded = true): void {
    const panel = this.el('panel');
    panel.hidden = !expanded;
    this.el('launcher').hidden = expanded;
    if (expanded) panel.scrollTop = 0;
  }
  private commit(): void { this.renderSettings(); this.actions.save(structuredClone(this.settings)); }
  setSettings(settings: Settings): void { this.settings = structuredClone(settings); this.renderSettings(); }
  private addName(value: string, kind: PickKind = this.editingKind): boolean {
    const name = priorityName(value, kind);
    if (!name) { this.message('請輸入卡牌名稱。'); return false; }
    if (this.names(kind).some(n => normalizeName(n) === normalizeName(name))) { this.message('這張卡牌已在清單中。'); return false; }
    if (this.names(kind).length >= 200) { this.message('每組清單最多 200 張。'); return false; }
    const names = uniqueNames([...this.names(kind), name]);
    if (kind === 'chest') this.profile().chestPriorities = names;
    else this.profile().priorities = names;
    this.editingKind = kind;
    this.commit(); this.message(`已加入「${name}」。`); return true;
  }
  private move(from: number, to: number): void {
    const names = this.names();
    if (from < 0 || to < 0 || from >= names.length || to >= names.length || from === to) return;
    names.splice(to, 0, names.splice(from, 1)[0]); this.commit();
  }
  private renderSettings(): void {
    const select = this.select('profiles'); select.replaceChildren();
    for (const p of this.settings.profiles) {
      const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; select.append(option);
    }
    select.value = this.settings.activeProfileId;
    this.input('fallback').checked = this.settings.fallback === 'rarity';
    this.input('chest-fallback').checked = this.settings.chestFallback === 'rarity';
    if (this.shadow.activeElement !== this.input('walk-radius')) this.input('walk-radius').value = String(this.settings.walkRadius);
    if (this.shadow.activeElement !== this.input('walk-interval')) this.input('walk-interval').value = String(this.settings.walkIntervalMs / 1000);
    this.input('chest-replace').checked = this.settings.chestAutoReplace;
    this.input('auto-reroll').checked = this.settings.autoReroll;
    this.input('chest-auto-reroll').checked = this.settings.chestAutoReroll;
    this.input('prefer-new-skills').checked = this.settings.preferNewSkills;
    this.input('auto-collect-loot').checked = this.settings.autoCollectLoot;
    this.input('auto-roll-loot').checked = this.settings.autoRollLoot;
    for (const category of rollCategoryKeys) this.select(`roll-${category}`).value = this.settings.rollRules[category];
    this.input('delay-min').value = String(this.settings.delayMinMs);
    this.input('delay-max').value = String(this.settings.delayMaxMs);
    if (this.shadow.activeElement !== this.input('loop-stage')) this.input('loop-stage').value = this.settings.loopStageName;
    for (const kind of ['levelup', 'chest'] as const) this.el(`kind-${kind}`).setAttribute('aria-pressed', String(kind === this.editingKind));
    const rules = this.profile().rules[this.editingKind];
    const usualOrder = this.editingKind === 'chest'
      ? '清單內先選品質最高的道具，品質相同才依順位。拖曳或使用 ↑ ↓ 排序。'
      : this.settings.preferNewSkills ? '清單內橘色優先 → 尚未取得 → 原順位。同類候選由上到下優先。' : '由上到下依序優先。拖曳或使用 ↑ ↓ 排序。';
    this.el('priority-help').textContent = rules.highQuality.length
      ? `優先選標記為「高品質優先」的紫色以上卡牌，多張時先比品質，再比清單順位。其餘情況：${usualOrder}`
      : usualOrder;
    this.el('empty-priorities').textContent = this.editingKind === 'chest' ? '尚未設定寶箱順位。可從目前寶箱加入，或在上方勾選「寶箱未命中選最高稀有度」。' : '還沒有優先技能。輸入遊戲顯示的名稱，或從下方目前選牌加入。';
    const names = this.names();
    this.el('empty-priorities').hidden = names.length > 0;
    const list = this.el('priorities'); list.replaceChildren();
    names.forEach((name, index) => {
      const item = document.createElement('li'); item.className = 'priority'; item.draggable = true;
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(index + 1);
      const label = document.createElement('span'); label.className = 'name'; label.textContent = name;
      item.append(rank, label);
      const toggles = document.createElement('div'); toggles.className = 'item-rules';
      for (const [key, title] of [['focus', '專注'], ['banish', '取得後放逐'], ['highQuality', '高品質優先']] as const) {
        const toggle = document.createElement('button');
        toggle.className = `rule-toggle ${key}`; toggle.textContent = title;
        if (key === 'highQuality') toggle.title = '這項出現紫色（史詩）以上品質時優先選取';
        toggle.setAttribute('aria-label', `${title} ${name}`);
        const active = rules[key].includes(name);
        toggle.setAttribute('aria-pressed', String(active));
        toggle.addEventListener('click', () => {
          rules[key] = active ? rules[key].filter(value => value !== name) : [...rules[key], name];
          if (!active && key !== 'highQuality') {
            const other = key === 'focus' ? 'banish' : 'focus';
            rules[other] = rules[other].filter(value => value !== name);
          }
          this.commit();
          this.el('priorities').querySelectorAll('.priority')[index]?.querySelector<HTMLButtonElement>(`.${key}`)?.focus();
        });
        toggles.append(toggle);
      }
      item.append(toggles);
      for (const [symbol, title, target] of [['↑', '上移', index - 1], ['↓', '下移', index + 1], ['×', '移除', -1]] as const) {
        const button = document.createElement('button'); button.className = 'icon'; button.textContent = symbol;
        button.setAttribute('aria-label', `${title} ${name}`);
        button.disabled = symbol !== '×' && (target < 0 || target >= names.length);
        button.addEventListener('click', () => {
          if (symbol !== '×') { this.move(index, target); return; }
          names.splice(index, 1);
          rules.focus = rules.focus.filter(value => value !== name);
          rules.banish = rules.banish.filter(value => value !== name);
          rules.highQuality = rules.highQuality.filter(value => value !== name);
          this.commit();
        });
        item.append(button);
      }
      item.addEventListener('dragstart', event => { this.dragged = index; event.dataTransfer?.setData('text/plain', String(index)); });
      item.addEventListener('dragover', event => { event.preventDefault(); item.classList.add('drag-over'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', event => { event.preventDefault(); item.classList.remove('drag-over'); this.move(this.dragged, index); this.dragged = -1; });
      item.addEventListener('dragend', () => { this.dragged = -1; });
      list.append(item);
    });
    this.currentKey = '';
    if (this.state) this.update(this.state);
  }
  update(state: ViewState): void {
    this.state = state;
    const stages = stageChoices().filter(stage => stage.available).map(stage => stage.name);
    if (stages.length && JSON.stringify(stages) !== this.stagesKey) {
      this.stagesKey = JSON.stringify(stages);
      this.el('loop-stages').replaceChildren(...stages.map(name => { const option = document.createElement('option'); option.value = name; return option; }));
    }
    const kind = state.snapshot?.kind;
    if (kind !== this.lastRoundKind) {
      this.lastRoundKind = kind ?? '';
      if ((kind === 'levelup' || kind === 'chest') && this.editingKind !== kind && !this.shadow.activeElement?.matches('input:not([type=checkbox])')) {
        this.editingKind = kind; this.renderSettings(); return;
      }
    }
    this.el('status').textContent = state.status;
    const running = state.enabled || this.walking || !!this.loopState?.enabled;
    this.el('mode').textContent = running ? 'AUTO / 自動功能已啟用' : 'PREVIEW / 預覽';
    this.el('mode').classList.toggle('on', running);
    this.input('toggle').checked = state.enabled;
    (this.el('pause-all') as HTMLButtonElement).disabled = !running;
    this.el('launcher').classList.toggle('active', state.enabled || this.walking);
    this.el('launcher').textContent = this.loopState?.enabled ? '選牌助手 · 循環中' : this.walking ? '選牌助手 · 走動已勾選' : state.enabled ? '選牌助手 · 自動' : '♧ 選牌助手';
    this.el('timer').textContent = state.snapshot?.timer ? `${state.snapshot.timer} · 遊戲倒數仍會繼續，逾時可能自行選牌。` : '';
    const key = JSON.stringify([state.snapshot?.signature, state.snapshot?.closing, state.recommendation, this.profile().priorities, this.profile().chestPriorities]);
    if (key !== this.currentKey) {
      this.currentKey = key;
      const target = this.el('current'); target.replaceChildren();
      if (!state.snapshot?.cards.length) {
        const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '升級或寶箱選牌出現後，會在這裡顯示。'; target.append(empty);
      } else {
        state.snapshot.cards.forEach((card, index) => {
          const recommended = index === state.recommendation.index && !state.snapshot?.closing;
          const block = document.createElement('div'); block.className = `card${recommended ? ' recommended' : ''}`;
          const row = document.createElement('div'); row.className = 'row';
          const name = document.createElement('strong'); name.textContent = `${index + 1}. ${card.name || '無法辨識名稱'}`;
          const add = document.createElement('button'); add.setAttribute('aria-label', `加入 ${card.name} 到清單`);
          const cardKind = state.snapshot!.kind;
          const supported = cardKind === 'levelup' || cardKind === 'chest';
          const alreadyAdded = supported && this.names(cardKind).some(n => normalizeName(n) === normalizeName(priorityName(card.name, cardKind)));
          add.disabled = !supported || !card.name || alreadyAdded;
          add.textContent = alreadyAdded ? '已加入' : !supported ? '未支援' : !card.name ? '無名稱' : '＋清單';
          add.title = alreadyAdded ? `已在${cardKind === 'chest' ? '寶箱道具' : '升級技能'}清單中`
            : !supported ? '尚未辨識此選牌畫面，請手動輸入名稱加入清單'
            : !card.name ? '無法讀取卡牌名稱' : `加入${cardKind === 'chest' ? '寶箱道具' : '升級技能'}清單`;
          add.addEventListener('click', () => { if (supported) this.addName(card.name, cardKind); });
          row.append(name, add); block.append(row);
          const ownership = !supported ? '' : card.ownership === 'new' ? '尚未取得' : card.ownership === 'owned' ? '已取得・升級牌' : '取得狀態未知';
          const detail = document.createElement('small'); detail.textContent = [ownership, card.badge, card.details, card.requiresConfirmation ? '將替換原有道具' : ''].filter(Boolean).join(' · '); block.append(detail);
          if (recommended) { const why = document.createElement('div'); why.className = 'reason'; why.textContent = `推薦 · ${state.recommendation.reason}`; block.append(why); }
          target.append(block);
        });
      }
    }
    const logKey = JSON.stringify(state.logs);
    if (logKey !== this.logKey) {
      this.logKey = logKey; const logs = this.el('logs'); logs.replaceChildren();
      if (!state.logs.length) { const empty = document.createElement('p'); empty.textContent = '尚無選牌紀錄。'; logs.append(empty); }
      for (const entry of state.logs) {
        const p = document.createElement('p'); const time = document.createElement('time'); time.textContent = entry.time;
        p.append(time, document.createTextNode(entry.text)); logs.append(p);
      }
    }
  }
  updateWalk(enabled: boolean, status: string): void {
    this.walking = enabled;
    this.input('walk-toggle').checked = enabled;
    this.el('walk-status').hidden = false;
    this.el('walk-status').textContent = status;
    if (this.state) this.update(this.state);
  }
  updateLoop(state: LoopState): void {
    this.loopState = state;
    this.input('loop-toggle').checked = state.enabled;
    this.el('loop-status').hidden = state.status === '循環尚未啟用';
    this.el('loop-status').textContent = state.status;
    this.el('loop-count').textContent = `本分頁已結算 ${state.completed} 場`;
    const logs = this.el('loop-logs');
    if (logs.dataset.entries !== JSON.stringify(state.logs)) {
      logs.dataset.entries = JSON.stringify(state.logs);
      logs.replaceChildren(...state.logs.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    }
    if (this.state) this.update(this.state);
  }
}
