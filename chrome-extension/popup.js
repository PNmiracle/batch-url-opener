// popup.js

const urlInput = document.getElementById('urlInput');
const urlCount = document.getElementById('urlCount');
const clipStatus = document.getElementById('clipStatus');
const btnOpen = document.getElementById('btnOpen');
const btnQuick = document.getElementById('btnQuick');
const btnClear = document.getElementById('btnClear');
const statusEl = document.getElementById('status');

let isVika = false;
let vikaLinks = [];

// --- 初始化：检测当前页面是否是 Vika ---

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (tab && tab.url && (tab.url.includes('vika.cn') || tab.url.includes('vika.com'))) {
    isVika = true;
    clipStatus.textContent = '正在检测 Vika 选中内容...';
    // 向 content script 请求选中行的链接
    chrome.tabs.sendMessage(tab.id, { action: 'GET_SELECTED_LINKS' }, (response) => {
      if (chrome.runtime.lastError) {
        clipStatus.textContent = 'Vika 页面未加载完成';
        return;
      }
      if (response && response.links && response.links.length > 0) {
        vikaLinks = response.links;
        urlInput.value = vikaLinks.join('\n');
        updateCount();
        clipStatus.textContent = `Vika 中检测到 ${vikaLinks.length} 个链接`;
        statusEl.textContent = '点击「批量打开」即可打开所有选中行的链接';
        statusEl.className = 'status good';
      } else {
        clipStatus.textContent = 'Vika 中未检测到选中链接';
        // 回退到剪贴板读取
        pasteFromClipboard();
      }
    });
  } else {
    // 非 Vika 页面，读取剪贴板
    pasteFromClipboard();
  }
});

// --- URL 提取与规范化 ---

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

function getUrls() {
  return extractUrls(urlInput.value);
}

function updateCount() {
  const urls = getUrls();
  urlCount.textContent = urls.length;
}

// --- 打开链接 ---

function openUrls(urls) {
  const normalized = urls.map(u => {
    if (/^https?:\/\//i.test(u)) return u;
    return 'https://' + u;
  });

  for (const u of normalized) {
    chrome.tabs.create({ url: u, active: false });
  }

  statusEl.textContent = `已打开 ${normalized.length} 个链接`;
  statusEl.className = 'status good';
}

// --- 读取剪贴板 ---

async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return text;
  } catch (e) {
    return null;
  }
}

async function pasteFromClipboard() {
  clipStatus.textContent = '读取剪贴板...';
  const text = await readClipboard();
  if (text) {
    urlInput.value = text;
    updateCount();
    const count = getUrls().length;
    clipStatus.textContent = count > 0 ? `剪贴板中检测到 ${count} 个链接` : '剪贴板中未检测到链接';
  } else {
    clipStatus.textContent = '无法读取剪贴板';
  }
}

// --- 事件绑定 ---

urlInput.addEventListener('input', updateCount);

btnClear.addEventListener('click', () => {
  urlInput.value = '';
  updateCount();
  statusEl.textContent = '';
  statusEl.className = 'status';
});

btnOpen.addEventListener('click', () => {
  const urls = getUrls();
  if (urls.length === 0) {
    statusEl.textContent = '未识别到链接';
    statusEl.className = 'status bad';
    return;
  }
  openUrls(urls);
});

// 「粘贴并打开」：先读剪贴板，再直接打开（不展示内容）
btnQuick.addEventListener('click', async () => {
  const text = await readClipboard();
  if (!text) {
    statusEl.textContent = '无法读取剪贴板';
    statusEl.className = 'status bad';
    return;
  }
  const urls = extractUrls(text);
  if (urls.length === 0) {
    statusEl.textContent = '剪贴板中未检测到链接';
    statusEl.className = 'status bad';
    return;
  }
  openUrls(urls);
  // 关闭 popup
  window.close();
});
