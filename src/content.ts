import { STORAGE_KEY, sanitizeSettings } from './core';
import { PickerEngine } from './engine';
import { Panel } from './panel';
import { loadSettings, saveSettings } from './storage';
import { RunLoop } from './run-loop';

async function main(): Promise<void> {
  if (document.getElementById('ro-picker-assistant')) return;
  const settings = await loadSettings();
  const engine = new PickerEngine(settings);
  const loop = new RunLoop(settings.loopStageName);
  const pauseAll = () => { if (loop.state.enabled) loop.stop(); if (engine.state.enabled) engine.setEnabled(false); };
  let pendingSave = Promise.resolve();
  const panel = new Panel(structuredClone(settings), {
    save(next) {
      engine.updateSettings(next);
      loop.updateStage(next.loopStageName);
      pendingSave = pendingSave.then(() => saveSettings(next)).catch(() => {
        engine.pauseWithError('設定儲存失敗，已暫停。請重新整理遊戲後再試。');
        if (loop.state.enabled) loop.stop('設定儲存失敗，循環已暫停');
        panel.message('設定未儲存，請重新整理後確認清單。');
      });
    },
    enable: enabled => enabled ? engine.setEnabled(true) : pauseAll(),
    clearLogs: () => engine.clearLogs(),
    loop(enabled) {
      if (!enabled) { pauseAll(); return; }
      loop.start();
      if (loop.state.enabled) engine.setEnabled(true);
    },
  });
  const style = document.createElement('style');
  style.textContent = '#picker .pk-card[data-ro-recommended="true"] { outline: 3px solid #77dbbb !important; outline-offset: 4px !important; }';
  document.documentElement.append(style);
  let highlighted: HTMLElement | null = null;
  engine.subscribe(state => {
    if (!state.enabled && loop.state.enabled) loop.stop('自動選牌已停止，循環一併暫停');
    panel.update(state);
    const index = state.recommendation.index;
    const target = index !== null && !state.snapshot?.closing ? state.snapshot?.cards[index]?.element ?? null : null;
    if (highlighted !== target) {
      highlighted?.removeAttribute('data-ro-recommended');
      target?.setAttribute('data-ro-recommended', 'true'); highlighted = target;
    }
  });
  let wasLoopEnabled = false;
  loop.subscribe(state => {
    if (wasLoopEnabled && !state.enabled && engine.state.enabled) engine.setEnabled(false);
    wasLoopEnabled = state.enabled;
    panel.updateLoop(state);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      const next = sanitizeSettings(changes[STORAGE_KEY].newValue);
      engine.updateSettings(next); loop.updateStage(next.loopStageName); panel.setSettings(next);
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'RO_PICKER_SHOW') { panel.show(); respond({ ok: true }); }
    else if (message?.type === 'RO_PICKER_STATUS') respond({ enabled: engine.state.enabled || loop.state.enabled, status: loop.state.enabled ? `${loop.state.status} · 已結算 ${loop.state.completed} 場` : engine.state.status });
    else if (message?.type === 'RO_PICKER_PAUSE') { pauseAll(); respond({ ok: true }); }
  });
}
void main().catch(error => console.error('[RO 選牌助手] 啟動失敗，請重新整理頁面。', error));
