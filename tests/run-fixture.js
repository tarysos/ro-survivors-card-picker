// Independently authored screen contracts. No game source, assets, or network calls.
(() => {
  const root = document.createElement('div');
  root.innerHTML = `
    <style>#loop-lab{max-width:700px}#loop-lab button{padding:12px;margin:5px}#loop-lab .overlay{padding:16px;border:1px solid #63836e}#loop-lab .sel{outline:3px solid #72d7b4}#loop-lab .diff input{display:block}#loop-lab h2{font-size:18px}</style>
    <section id="loop-lab"><h2>循環刷關測試場景</h2>
      <div id="hud" class="hidden"><span id="minimap-name">斐揚森林</span><div>戰鬥中</div></div>
      <div id="lobby-ui" class="hidden"><div id="lobby-labels"><span class="lobby-name npc">遠征隊長</span></div><button id="lobby-prompt">與隊長交談 <kbd>空白鍵</kbd></button></div>
      <div id="stages" class="overlay hidden"><div class="ro-title">遠征</div><div id="stg-list"></div><div id="stg-detail"></div><button id="stg-go">出發</button><button id="stg-story">劇情</button><button id="stg-skip">跳過劇情</button></div>
      <div id="npc-dialog" class="overlay hidden"><div id="npc-name" class="ro-title"></div><div id="npc-text"></div><div id="npc-options"></div></div>
      <div id="loading" class="overlay hidden">讀取中</div>
      <div id="gameover" class="overlay hidden"><div id="go-title" class="ro-title">結算</div><button id="btn-restart">返回角色</button></div>
    </section>`;
  document.body.append(root);
  const el = id => document.getElementById(id);
  const flow = window.runFixture = {
    actions: [], selected: '普隆德拉原野', departure: '', reject: '', dialog: '',
    stages: [{ name: '普隆德拉原野', available: true }, { name: '斐揚森林', available: true }, { name: '未解鎖關卡', available: false }, { name: '故事關卡', available: true, story: true }],
    difficulty: { count: 2, damage: 1.25, hp: 1.5, speed: 1.1, events: 1.75 },
    screen(id) {
      for (const key of ['hud', 'lobby-ui', 'stages', 'npc-dialog', 'loading', 'gameover']) el(key).classList.toggle('hidden', key !== id);
      document.body.classList.toggle('in-lobby', ['lobby-ui', 'stages', 'npc-dialog'].includes(id));
    },
    battle() { el('minimap-name').textContent = flow.departure || '斐揚森林'; flow.screen('hud'); },
    settle(win = true) { flow.screen('gameover'); el('go-title').textContent = win ? '你存活下來了！' : '你死了'; },
    lobby() { flow.screen('lobby-ui'); },
    openStages() {
      flow.screen('stages');
      el('stg-list').replaceChildren(...flow.stages.map(stage => {
        const button = document.createElement('button');
        button.className = `stg-card ${stage.available ? 'open' : 'locked'}${flow.selected === stage.name ? ' sel' : ''}`;
        const info = document.createElement('span'); info.className = 'stg-card-info';
        const name = document.createElement('b'); name.textContent = stage.name; info.append(name); button.append(info);
        button.onclick = () => { flow.actions.push(`select:${stage.name}`); if (flow.reject !== 'select') { flow.selected = stage.name; flow.openStages(); } };
        return button;
      }));
      const banner = document.createElement('div'); banner.className = 'stg-banner-text';
      const name = document.createElement('b'); name.textContent = flow.selected; banner.append(name); el('stg-detail').replaceChildren(banner);
      el('stg-go').disabled = !flow.stages.find(stage => stage.name === flow.selected)?.available;
      el('stg-go').classList.toggle('hidden', !!flow.stages.find(stage => stage.name === flow.selected)?.story);
    },
    openDifficulty() {
      flow.screen('npc-dialog');
      el('npc-name').textContent = flow.dialog === 'saved' ? '未完成的遊戲' : '難度';
      el('npc-text').innerHTML = `<div class="diff">${Object.entries(flow.difficulty).map(([key, value]) => `<input type="range" data-key="${key}" min="1" max="3.5" step="0.05" value="${value}">`).join('')}${flow.dialog === 'party' ? '<input type="range" data-pick>' : ''}</div>`;
      const button = document.createElement('button'); button.className = 'primary'; button.textContent = flow.dialog === 'party' ? '向隊伍提議' : flow.dialog === 'saved' ? '繼續' : '前往野外';
      button.onclick = () => {
        flow.actions.push('confirm');
        flow.confirmedDifficulty = Object.fromEntries([...el('npc-text').querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.valueAsNumber]));
        if (flow.reject !== 'confirm') { flow.screen('loading'); setTimeout(() => flow.battle(), 350); }
      };
      el('npc-options').replaceChildren(button);
    },
  };
  el('lobby-prompt').onclick = () => { flow.actions.push('captain'); if (flow.reject !== 'captain') flow.openStages(); };
  el('stg-go').onclick = () => { flow.actions.push(`depart:${flow.selected}`); flow.departure = flow.selected; if (flow.reject !== 'depart') flow.openDifficulty(); };
  el('stg-story').onclick = () => flow.actions.push('story'); el('stg-skip').onclick = () => flow.actions.push('skip');
  el('btn-restart').onclick = () => { flow.actions.push('return'); if (flow.reject !== 'return') { flow.screen('loading'); setTimeout(() => flow.lobby(), 350); } };
  flow.battle();
})();
