(() => {
  const root = document.createElement('div'); root.id = 'drop-reveal'; root.className = 'hidden';
  root.style.cssText = 'padding:24px;border:1px solid #a98057;max-width:650px;background:#213039'; document.body.append(root);
  window.lootClicks = []; window.lootTaken = [];
  window.showLoot = (options = {}) => {
    root.className = options.roll ? 'roll' : '';
    root.replaceChildren();
    const name = document.createElement('div'); name.className = 'dr-name'; name.textContent = options.name || '測試裝備';
    const quality = document.createElement('div'); quality.className = 'dr-q'; quality.textContent = options.badge || '史詩 · Tier 2';
    const button = document.createElement('button'); button.className = 'dr-get'; button.textContent = options.label || '取得';
    button.disabled = !!options.disabled;
    if (options.roll) { button.dataset.c = 'need'; button.className = 'dr-roll'; }
    root.append(name, quality, button);
    const start = performance.now();
    root.onclick = event => {
      window.lootClicks.push({ name: name.textContent, elapsed: performance.now() - start, target: event.target.className });
      if (performance.now() - start < 600 || options.reject) return;
      window.lootTaken.push(name.textContent);
      root.classList.add('hidden'); root.replaceChildren(); root.onclick = null;
      if (options.next) window.showLoot(options.next);
    };
  };
})();
