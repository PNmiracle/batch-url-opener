// popup.js

const urlInput = document.getElementById('urlInput');
const urlCount = document.getElementById('urlCount');
const clipStatus = document.getElementById('clipStatus');
const btnOpen = document.getElementById('btnOpen');
const btnQuick = document.getElementById('btnQuick');
const btnClear = document.getElementById('btnClear');
const statusEl = document.getElementById('status');

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
  clipStatus.textContent = '读取中...';
  const text = await readClipboard();
  if (text) {
    urlInput.value = text;
    updateCount();
    const count = getUrls().length;
    clipStatus.textContent = count > 0 ? `检测到 ${count} 个链接` : '未检测到链接';
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

// 自动读取剪贴板
pasteFromClipboard();
updateCount();
