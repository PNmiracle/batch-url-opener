// popup.js

const urlInput = document.getElementById('urlInput');
const urlCount = document.getElementById('urlCount');
const clipStatus = document.getElementById('clipStatus');
const btnOpen = document.getElementById('btnOpen');
const btnQuick = document.getElementById('btnQuick');
const btnDetect = document.getElementById('btnDetect');
const btnClear = document.getElementById('btnClear');
const statusEl = document.getElementById('status');
const detectResults = document.getElementById('detectResults');

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

// --- 链接检测 ---

const PAGE_TYPE_LABELS = {
  'personal': '🏠 个人主页',
  'likely-personal': '🏠 可能是个人主页',
  'lab': '🧪 实验室页面',
  'likely-lab': '🧪 可能是实验室页面',
  'unknown': '❓ 未知',
  'error': '⚠️ 无法判断'
};

btnDetect.addEventListener('click', async () => {
  const urls = getUrls();
  if (urls.length === 0) {
    statusEl.textContent = '未识别到链接';
    statusEl.className = 'status bad';
    return;
  }

  btnDetect.disabled = true;
  btnDetect.textContent = '⏳ 检测中...';
  detectResults.style.display = 'block';
  detectResults.innerHTML = '<div style="color:#888;font-size:12px;padding:8px 0;">正在检测 ' + urls.length + ' 个链接...</div>';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CHECK_LINKS', links: urls }, resolve);
    });

    if (response.error) {
      detectResults.innerHTML = '<div style="color:#e17055;font-size:12px;">检测失败：' + response.error + '</div>';
      return;
    }

    renderDetectResults(response.results);
  } catch (e) {
    detectResults.innerHTML = '<div style="color:#e17055;font-size:12px;">检测失败：' + e.message + '</div>';
  } finally {
    btnDetect.disabled = false;
    btnDetect.textContent = '🔍 检测';
  }
});

function renderDetectResults(results) {
  const ok = results.filter(r => r.status >= 200 && r.status < 300).length;
  const dead = results.filter(r => r.status === 404 || r.status >= 500 || r.error).length;
  const labs = results.filter(r => r.pageType === 'lab' || r.pageType === 'likely-lab').length;
  const personals = results.filter(r => r.pageType === 'personal' || r.pageType === 'likely-personal').length;

  let html = '<div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.8;">';
  html += '<span style="color:#00b894;">✅ ' + ok + ' 正常</span>';
  if (dead > 0) html += ' &nbsp;|&nbsp; <span style="color:#e17055;">❌ ' + dead + ' 异常</span>';
  html += ' &nbsp;|&nbsp; 🏠 ' + personals + ' &nbsp; 🧪 ' + labs;
  html += '</div>';

  results.forEach((r, i) => {
    const bg = i % 2 === 0 ? '#fafbfc' : '';
    const icon = r.error ? '🔴' : 
      r.status >= 200 && r.status < 300 ? '✅' :
      r.status === 404 ? '❌' : r.status >= 500 ? '💥' : '⚠️';
    const st = r.error ? '无法连接' : r.status + ' ' + (r.statusText || '');
    const sc = r.error ? '#888' : r.status >= 200 && r.status < 300 ? '#00b894' : '#e17055';
    const shortUrl = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 30);

    html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:4px;font-size:11px;cursor:pointer;background:' + bg + ';" onclick="window.open(\'' + r.url + '\',\'_blank\')">';
    html += '<span>' + icon + '</span>';
    html += '<span style="font-weight:500;color:' + sc + ';min-width:55px;">' + st + '</span>';
    html += '<span style="color:#6c5ce7;min-width:70px;">' + (PAGE_TYPE_LABELS[r.pageType] || '❓') + '</span>';
    html += '<span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + r.url + '">' + shortUrl + '</span>';
    html += '</div>';
  });

  detectResults.innerHTML = html;
}
