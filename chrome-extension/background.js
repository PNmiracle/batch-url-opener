// background.js - Service Worker for Chrome Extension (Manifest V3)

// 安装/更新时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-clipboard-urls',
    title: '打开剪贴板中的所有链接',
    contexts: ['all']
  });
});

// 点击右键菜单：读取剪贴板 → 提取 URL → 批量打开
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-clipboard-urls') {
    openUrlsFromClipboard();
  }
});

// 快捷键：打开 Vika 表格中选中行的链接
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-selected-links') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;
      const tab = tabs[0];
      // 向 content script 请求选中行的链接
      chrome.tabs.sendMessage(tab.id, { action: 'GET_SELECTED_LINKS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('无法与 content script 通信:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.links && response.links.length > 0) {
          openLinks(response.links);
        }
      });
    });
  }
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_LINKS') {
    openLinks(message.links);
    sendResponse({ success: true });
  }
  return true;
});

// 打开链接
function openLinks(links) {
  for (const url of links) {
    chrome.tabs.create({ url, active: false });
  }
}

// 从剪贴板读取并打开链接
async function openUrlsFromClipboard() {
  try {
    const text = await readClipboard();
    const urls = extractUrls(text);
    if (urls.length > 0) {
      openLinks(urls);
    }
  } catch (e) {
    console.error('Failed to open URLs from clipboard:', e);
  }
}

// 读取剪贴板文本
async function readClipboard() {
  // Service worker 无法直接访问 navigator.clipboard
  // 通过 offscreen document 来实现
  const existingContexts = await chrome.runtime.getContexts({});
  const offscreenDoc = existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');

  if (!offscreenDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: '读取剪贴板中的链接'
    });
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'READ_CLIPBOARD' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response && response.text !== undefined) {
        resolve(response.text);
      } else {
        reject(new Error('No clipboard text'));
      }
    });
  });
}

// 从文本中提取 URL
function extractUrls(text) {
  const cleaned = text
    .replace(/[，]/g, ',')
    .replace(/[\s]+/g, '\n')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const urls = cleaned.filter(s => {
    if (/^https?:\/\//i.test(s)) return true;
    if (/^[\w-]+\.\w{2,}/.test(s)) return true;
    return false;
  });

  // 去重
  const seen = new Set();
  const result = [];
  for (const u of urls) {
    const norm = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}
