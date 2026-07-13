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

// 点击扩展图标（无 popup 时的 fallback）
chrome.action.onClicked.addListener(() => {
  openUrlsFromClipboard();
});

// 从剪贴板读取并打开链接
async function openUrlsFromClipboard() {
  try {
    const text = await readClipboard();
    const urls = extractUrls(text);
    if (urls.length === 0) return;

    for (const url of urls) {
      chrome.tabs.create({ url, active: false });
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
