import styles from './panel.css';
import { normalizeName, priorityName, skillRules, uniqueNames } from './core';
import type { PickKind, Settings, ViewState } from './types';

interface Actions {
  save(settings: Settings): void;
  enable(enabled: boolean): void;
  clearLogs(): void;
}
export class Panel {
  private shadow: ShadowRoot;
  private settings: Settings;
  private state: ViewState | null = null;
  private currentKey = '';
  private logKey = '';
  private dragged = -1;
  private expanded = false;
  private editingKind: PickKind = 'levelup';
  private lastRoundKind = '';
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
        <header><span class="logo" aria-hidden="true">♧</span><div><strong>RO 選牌助手</strong><small>你的清單，你的打法 · v0.3.2</small></div><button class="icon" id="collapse" aria-label="收合面板">−</button></header>
        <div class="body">
          <div class="toolbar"><span class="mode" id="mode">PREVIEW / 預覽</span><button id="toggle" class="primary">啟用自動選牌</button></div>
          <p class="status" id="status" role="status" aria-live="polite"></p>
          <div class="timer" id="timer"></div>
          <div class="note">自動處理升級技能與寶箱選牌。重新整理後回到預覽模式。</div>
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
            <label class="checkbox-row"><input id="auto-focus" type="checkbox">技能第一順位自動專注</label>
            <label class="checkbox-row"><input id="auto-banish" type="checkbox">技能最後兩順位：先取得，再放逐</label>
            <p class="note">技能清單至少 3 項才啟用。最後兩順位尚未取得時仍依順位選入；已取得後，再出現升級牌才放逐、不繼續升級。專注、放逐有剩餘次數才會執行。</p>
            <label class="checkbox-row"><input id="auto-reroll" type="checkbox">技能沒有目標牌時全部重抽</label>
            <label class="checkbox-row"><input id="chest-auto-reroll" type="checkbox">寶箱沒有目標牌時全部重抽</label>
            <p class="note">有設定目標清單才會重抽。重抽次數用完後，依下方未命中規則處理。</p>
            <label class="note" for="fallback">技能清單沒有命中時</label>
            <select id="fallback"><option value="pause">交由我手動選擇</option><option value="rarity">選最高稀有度（必須全部辨識成功）</option></select>
            <label class="note" for="chest-fallback">寶箱清單沒有命中時</label>
            <select id="chest-fallback"><option value="pause">交由我手動選擇</option><option value="rarity">選最高稀有度（必須全部辨識成功）</option></select>
            <label class="checkbox-row"><input id="chest-replace" type="checkbox">寶箱自動確認替換</label>
            <p class="note">清單內候選牌先比品質，同品質再比順位；勾選後會確認替換該欄位原有道具。關閉後，需替換的牌交由你處理。</p>
            <div class="note" style="margin-top:12px">每輪隨機選牌延遲（毫秒）</div>
            <div class="row delay-range"><label for="delay-min">最短<input id="delay-min" type="number" min="500" max="5000" step="100"></label><span>～</span><label for="delay-max">最長<input id="delay-max" type="number" min="500" max="5000" step="100"></label></div>
            <p class="note">預設 500～1500 毫秒，每輪重新抽取一次。若遊戲動畫尚未結束，會等到可操作時才點選。</p>
            <p class="note">技能先比順位，再比稀有度；寶箱清單內先比品質（稀有度），再比順位。皆相同時由左至右。寶箱名稱會忽略結尾的 +1、+2 等強化數字；切換語言後請確認清單。</p>
          </details>
          <details class="section"><summary>本分頁紀錄（最近 30 筆）</summary><div id="logs" class="log"></div><button id="clear-logs">清除紀錄</button></details>
          <footer>設定儲存在此瀏覽器。自動選牌開關只作用於目前分頁。</footer>
        </div>
      </section>`;
    document.documentElement.append(host);
    this.shadow.addEventListener('keydown', event => event.stopPropagation());
    for (const name of ['pointerdown', 'pointerup', 'click', 'wheel']) this.shadow.addEventListener(name, event => event.stopPropagation());
    this.on('launcher', 'click', () => this.show());
    this.on('collapse', 'click', () => this.show(false));
    this.on('toggle', 'click', () => actions.enable(!this.state?.enabled));
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
      this.settings.profiles.push({ id, name, priorities: [], chestPriorities: [] }); this.settings.activeProfileId = id; this.commit();
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
      this.settings.fallback = this.select('fallback').value === 'rarity' ? 'rarity' : 'pause'; this.commit();
    });
    this.on('chest-fallback', 'change', () => {
      this.settings.chestFallback = this.select('chest-fallback').value === 'rarity' ? 'rarity' : 'pause'; this.commit();
    });
    this.on('chest-replace', 'change', () => { this.settings.chestAutoReplace = this.input('chest-replace').checked; this.commit(); });
    for (const [id, key] of [['auto-focus', 'autoFocusFirst'], ['auto-banish', 'autoBanishLastTwo'], ['auto-reroll', 'autoReroll'], ['chest-auto-reroll', 'chestAutoReroll']] as const) {
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
    this.expanded = expanded; this.el('panel').hidden = !expanded; this.el('launcher').hidden = expanded;
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
    this.select('fallback').value = this.settings.fallback;
    this.select('chest-fallback').value = this.settings.chestFallback;
    this.input('chest-replace').checked = this.settings.chestAutoReplace;
    this.input('auto-focus').checked = this.settings.autoFocusFirst;
    this.input('auto-banish').checked = this.settings.autoBanishLastTwo;
    this.input('auto-reroll').checked = this.settings.autoReroll;
    this.input('chest-auto-reroll').checked = this.settings.chestAutoReroll;
    this.input('delay-min').value = String(this.settings.delayMinMs);
    this.input('delay-max').value = String(this.settings.delayMaxMs);
    for (const kind of ['levelup', 'chest'] as const) this.el(`kind-${kind}`).setAttribute('aria-pressed', String(kind === this.editingKind));
    this.el('priority-help').textContent = this.editingKind === 'chest'
      ? '清單內先選品質最高的道具，品質相同才依順位。拖曳或使用 ↑ ↓ 排序。'
      : '由上到下依序優先。拖曳或使用 ↑ ↓ 排序。';
    this.el('empty-priorities').textContent = this.editingKind === 'chest' ? '尚未設定寶箱順位。可從目前寶箱加入，或在選牌設定改用最高稀有度。' : '還沒有優先技能。輸入遊戲顯示的名稱，或從下方目前選牌加入。';
    const names = this.names();
    this.el('empty-priorities').hidden = names.length > 0;
    const list = this.el('priorities'); list.replaceChildren();
    const rules = skillRules(this.settings);
    names.forEach((name, index) => {
      const item = document.createElement('li'); item.className = 'priority'; item.draggable = true;
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(index + 1);
      const label = document.createElement('span'); label.className = 'name'; label.textContent = name;
      item.append(rank, label);
      if (this.editingKind === 'levelup') {
        const role = rules.focus === name ? '專注' : rules.banishAfterLearning.includes(name) ? '取得後放逐' : '';
        if (role) { const tag = document.createElement('span'); tag.className = `rule-tag ${role === '取得後放逐' ? 'banish' : ''}`; tag.textContent = role; item.append(tag); }
      }
      for (const [symbol, title, target] of [['↑', '上移', index - 1], ['↓', '下移', index + 1], ['×', '移除', -1]] as const) {
        const button = document.createElement('button'); button.className = 'icon'; button.textContent = symbol;
        button.setAttribute('aria-label', `${title} ${name}`);
        button.disabled = symbol !== '×' && (target < 0 || target >= names.length);
        button.addEventListener('click', () => { if (symbol === '×') { names.splice(index, 1); this.commit(); } else this.move(index, target); });
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
    const kind = state.snapshot?.kind;
    if (kind !== this.lastRoundKind) {
      this.lastRoundKind = kind ?? '';
      if ((kind === 'levelup' || kind === 'chest') && this.editingKind !== kind && this.shadow.activeElement?.tagName !== 'INPUT') {
        this.editingKind = kind; this.renderSettings(); return;
      }
    }
    this.el('status').textContent = state.status;
    this.el('mode').textContent = state.enabled ? 'AUTO / 自動選牌' : 'PREVIEW / 預覽';
    this.el('mode').classList.toggle('on', state.enabled);
    this.el('toggle').textContent = state.enabled ? '暫停自動選牌' : '啟用自動選牌';
    this.el('toggle').classList.toggle('pause', state.enabled);
    this.el('launcher').classList.toggle('active', state.enabled);
    this.el('launcher').textContent = state.enabled ? '選牌助手 · 自動' : '♧ 選牌助手';
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
          const skillStatus = cardKind !== 'levelup' ? '' : card.skillState === 'new' ? '尚未取得' : card.skillState === 'owned' ? '已取得・升級牌' : '取得狀態未知';
          const detail = document.createElement('small'); detail.textContent = [skillStatus, card.badge, card.details, card.requiresConfirmation ? '將替換原有道具' : ''].filter(Boolean).join(' · '); block.append(detail);
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
}
