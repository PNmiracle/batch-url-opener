// offscreen.js - 在 offscreen document 中读取剪贴板

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'READ_CLIPBOARD') {
    navigator.clipboard.readText()
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ text: '', error: err.message }));
    return true; // 保持消息通道开启以支持异步响应
  }
});
