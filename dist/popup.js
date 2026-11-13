"use strict";
(() => {
  // src/popup.ts
  var show = document.getElementById("show");
  var pause = document.getElementById("pause");
  var statusElement = document.getElementById("status");
  var tabId;
  async function connect() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (tabId === void 0) throw new Error("no tab");
    const state = await chrome.tabs.sendMessage(tabId, { type: "RO_PICKER_STATUS" });
    statusElement.textContent = state.status;
    pause.hidden = !state.enabled;
  }
  show.addEventListener("click", () => {
    if (tabId !== void 0) void chrome.tabs.sendMessage(tabId, { type: "RO_PICKER_SHOW" }).then(() => window.close()).catch(disconnected);
  });
  pause.addEventListener("click", () => {
    if (tabId !== void 0) void chrome.tabs.sendMessage(tabId, { type: "RO_PICKER_PAUSE" }).then(connect).catch(disconnected);
  });
  function disconnected() {
    show.disabled = true;
    pause.hidden = true;
    statusElement.textContent = "\u8ACB\u5207\u5230 RO Survivors \u904A\u6232\u5206\u9801\u3002\u82E5\u5DF2\u958B\u555F\u904A\u6232\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u4E00\u6B21\u3002";
  }
  void connect().catch(disconnected);
})();
