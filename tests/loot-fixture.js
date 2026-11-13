(() => {
  const root = document.createElement('div'); root.id = 'drop-reveal'; root.className = 'hidden';
  root.style.cssText = 'padding:24px;border:1px solid #a98057;max-width:650px;background:#213039'; document.body.append(root);
  window.lootClicks = []; window.lootTaken = [];
  window.showLoot = (options = {}) => {
    root.className = options.roll ? 'roll' : '';
    root.replaceChildren();
    const name = document.createElement('div'); name.className = 'dr-name'; name.textContent = options.name ?? '測試裝備';
    const quality = document.createElement('div'); quality.className = 'dr-q'; quality.textContent = options.badge ?? '史詩 · Tier 2';
    const button = document.createElement('button'); button.className = 'dr-get'; button.textContent = options.label || '取得';
    button.disabled = !!options.disabled;
    root.append(name, quality);
    if (options.roll || options.artwork) {
      root.insertAdjacentHTML('beforeend', '<div class="dr-card"><img alt=""></div>');
      root.querySelector('img').src = options.artwork || 'assets/items/1201_art.png';
    }
    if (options.roll) {
      root.insertAdjacentHTML('beforeend', '<div class="dr-roll"><div class="dr-roll-btns"></div></div>');
      for (const choice of ['need', 'greed', 'pass']) {
        const rollButton = document.createElement('button');
        rollButton.dataset.c = choice;
        rollButton.textContent = choice;
        rollButton.disabled = options.disabled === choice;
        root.querySelector('.dr-roll-btns').append(rollButton);
      }
    } else root.append(button);
    if (options.result) root.append(Object.assign(document.createElement('div'), { className: 'dr-result' }));
    const start = performance.now();
    root.onclick = event => {
      if (options.roll && !event.target.closest('button[data-c]')) return;
      window.lootClicks.push({ name: name.textContent, elapsed: performance.now() - start, target: event.target.className, choice: event.target.dataset.c, manual: event.isTrusted });
      if (performance.now() - start < 600 || options.reject) return;
      window.lootTaken.push(name.textContent);
      root.classList.add('hidden'); root.replaceChildren(); root.onclick = null;
      if (options.next) window.showLoot(options.next);
    };
  };
})();
