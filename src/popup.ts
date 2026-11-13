const show = document.getElementById('show') as HTMLButtonElement;
const pause = document.getElementById('pause') as HTMLButtonElement;
const statusElement = document.getElementById('status')!;
let tabId: number | undefined;
async function connect(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (tabId === undefined) throw new Error('no tab');
  const state = await chrome.tabs.sendMessage(tabId, { type: 'RO_PICKER_STATUS' });
  statusElement.textContent = state.status; pause.hidden = !state.enabled;
}
show.addEventListener('click', () => {
  if (tabId !== undefined) void chrome.tabs.sendMessage(tabId, { type: 'RO_PICKER_SHOW' }).then(() => window.close()).catch(disconnected);
});
pause.addEventListener('click', () => {
  if (tabId !== undefined) void chrome.tabs.sendMessage(tabId, { type: 'RO_PICKER_PAUSE' }).then(connect).catch(disconnected);
});
function disconnected(): void { show.disabled = true; pause.hidden = true; statusElement.textContent = '請切到 RO Survivors 遊戲分頁。若已開啟遊戲，請重新整理一次。'; }
void connect().catch(disconnected);
